import { Bot, GrammyError } from 'grammy';
import type { ChannelConfig, ChannelSource } from '../types/telegram';
import type { FeedItem, FeedMediaFilter, FetchResult } from '../types/feed';
import { fetchFeed } from '../services/feed-fetcher';
import { fetchInstagramUser, fetchInstagramTag, fetchForSource } from '../services/source-fetcher';
import { getChannelConfig, saveChannelConfig, sendMediaToChannel } from '../services/telegram-bot';
import { sendFallbackMessage } from '../services/telegram-bot/helpers/fallback-sender';
import { formatFeedItem, resolveFormatSettings } from '../utils/telegram-format';
import { getCached, setCached } from '../utils/cache';
import {
	CACHE_KEY_TELEGRAM_CHANNELS,
	CACHE_PREFIX_TELEGRAM_SENT,
	TELEGRAM_CONFIG_TTL,
} from '../constants';
import { enrichFeedItems } from '../utils/media-enrichment';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Send an alert DM to the admin. Silently fails if notification itself errors.
 */
async function alertAdmin(bot: Bot, adminId: number, message: string): Promise<void> {
	try {
		await bot.api.sendMessage(adminId, message, { parse_mode: 'HTML' });
	} catch (e) {
		console.error('[Alert] Failed to notify admin:', e);
	}
}

/** Truncate error text to avoid hitting Telegram message limits. */
function truncErr(err: unknown, maxLen = 300): string {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.length > maxLen ? msg.slice(0, maxLen) + '...' : msg;
}

/**
 * Cron handler: iterate all channels, check due sources, send new posts.
 */
export async function checkAllFeeds(env: Env): Promise<void> {

	const channelsRaw = await getCached(env.CACHE, CACHE_KEY_TELEGRAM_CHANNELS);
	if (!channelsRaw) return;

	const channels: string[] = JSON.parse(channelsRaw);
	if (channels.length === 0) return;

	const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);
	const now = Date.now();

	for (const channelId of channels) {
		try {
			await checkChannel(channelId, now, bot, env, adminId);
		} catch (err) {
			console.error(`Error checking channel ${channelId}:`, err);
			await alertAdmin(bot, adminId,
				`<b>Cron channel error</b>\nChannel: <code>${channelId}</code>\n\n<pre>${truncErr(err)}</pre>`
			);
		}
	}
}

async function checkChannel(channelId: string, now: number, bot: Bot, env: Env, adminId: number): Promise<void> {
	const config = await getChannelConfig(env.CACHE, channelId);
	if (!config || !config.enabled) return;

	// Check if enough time has passed since last check
	const intervalMs = config.checkIntervalMinutes * 60 * 1000;
	if (now - config.lastCheckTimestamp < intervalMs) return;

	// Update last check timestamp
	config.lastCheckTimestamp = now;
	await saveChannelConfig(env.CACHE, channelId, config);

	// Check each enabled source
	for (const source of config.sources) {
		if (!source.enabled) continue;
		try {
			await checkSource(channelId, source, bot, env, config, adminId);
		} catch (err) {
			console.error(`Error checking source ${source.value} for channel ${channelId}:`, err);
			await alertAdmin(bot, adminId,
				`<b>Cron source error</b>\nChannel: <code>${channelId}</code>\nSource: <code>${source.value}</code>\n\n<pre>${truncErr(err)}</pre>`
			);
		}
	}
}

async function checkSource(channelId: string, source: ChannelSource, bot: Bot, env: Env, config: ChannelConfig, adminId: number): Promise<void> {
	const result = await fetchForSource(source, env);
	if (result.items.length === 0) {
		if (result.errors.length > 0) {
			console.error(`[Cron] All tiers failed for ${source.value}:`, JSON.stringify(result.errors));
			const errorSummary = result.errors
				.map((e) => `[${e.tier}] ${e.message ?? 'unknown'}`)
				.join('\n');
			await alertAdmin(bot, adminId,
				`<b>Fetch failed — all instances down</b>\nSource: <code>${source.value}</code>\nChannel: <code>${channelId}</code>\n\n<pre>${truncErr(errorSummary, 500)}</pre>`
			);
		}
		return;
	}

	// Filter by media type
	const items = filterItems(result.items, migrateMediaFilter(source));
	if (items.length === 0) return;

	// Get set of already-sent post links
	const sentKey = `${CACHE_PREFIX_TELEGRAM_SENT}${channelId}:${source.id}`;
	const sentRaw = await getCached(env.CACHE, sentKey);
	let sentLinks: string[] = [];
	try {
		const parsed = sentRaw ? JSON.parse(sentRaw) : [];
		if (Array.isArray(parsed)) sentLinks = parsed;
	} catch {
		// Old lastSeenId format or corrupt data — start fresh
	}
	const sentSet = new Set(sentLinks);

	// Find new items (not in sent set)
	const newItems = items.filter(item => !sentSet.has(item.link));

	if (newItems.length === 0) return;

	// Send oldest first
	newItems.reverse();

	// Limit to 5 posts per check to avoid flooding
	const postsToSend = newItems.slice(0, 5);

	// Enrich items that link to supported platforms (e.g. TikTok) but have no media
	await enrichFeedItems(postsToSend);

	const chatId = parseInt(channelId, 10);

	// Resolve format settings: hardcoded < channel defaults < source overrides
	const settings = resolveFormatSettings(config.defaultFormat, source.format);

	const sentItemLinks: string[] = [];
	for (let i = 0; i < postsToSend.length; i++) {
		const item = postsToSend[i];
		if (i > 0) await sleep(1500);
		try {
			const message = formatFeedItem(item, settings);
			await sendMediaToChannel(bot, chatId, message, settings);
			sentItemLinks.push(item.link);
		} catch (err) {
			if (err instanceof GrammyError && err.error_code === 429) {
				console.error(`[Cron] Rate limited on ${channelId}, stopping sends`);
				break;
			}
			console.error(`Failed to send item ${item.id} to ${channelId}:`, err);
			// Fallback: send thumbnail + link
			try {
				await sendFallbackMessage(bot, chatId, item);
				sentItemLinks.push(item.link);
			} catch (fallbackErr) {
				console.error(`Fallback also failed for ${item.id}:`, fallbackErr);
				if (fallbackErr instanceof GrammyError && fallbackErr.error_code === 429) {
					console.error(`[Cron] Rate limited on ${channelId}, stopping sends`);
					break;
				}
				await alertAdmin(bot, adminId,
					`<b>Send failed</b> (main + fallback)\nChannel: <code>${channelId}</code>\nSource: <code>${source.value}</code>\nItem: <code>${item.id}</code>\n\n<pre>${truncErr(fallbackErr)}</pre>`
				);
			}
		}
	}

	// Update sent links set — only record successfully sent items
	if (sentItemLinks.length > 0) {
		const merged = [...sentLinks, ...sentItemLinks];
		// Cap at 50 entries to prevent unbounded growth
		const capped = merged.slice(-50);
		await setCached(env.CACHE, sentKey, JSON.stringify(capped), TELEGRAM_CONFIG_TTL);
	} else {
		// All posts failed to send — don't update so they're retried
		await alertAdmin(bot, adminId,
			`<b>All posts failed to send</b>\nChannel: <code>${channelId}</code>\nSource: <code>${source.value}</code>\nItems: ${postsToSend.length}`
		);
	}
}

/**
 * Filter items by media type. Handles both new and legacy filter values.
 */
function filterItems(items: FeedItem[], filter: FeedMediaFilter): FeedItem[] {
	if (filter === 'all') return items;
	return items.filter((item) => item.mediaType === filter);
}

/**
 * Migrate legacy mediaType/mediaFilter values to FeedMediaFilter.
 */
function migrateMediaFilter(source: ChannelSource): FeedMediaFilter {
	// Handle both old field name (mediaType) and new (mediaFilter)
	const raw = source.mediaFilter ?? (source as any).mediaType ?? 'all';
	switch (raw) {
		case 'picture': return 'photo';
		case 'multiple': return 'album';
		default: return raw as FeedMediaFilter;
	}
}
