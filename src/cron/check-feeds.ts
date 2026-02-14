import { Bot } from 'grammy';
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
	CACHE_PREFIX_TELEGRAM_LASTSEEN,
	TELEGRAM_CONFIG_TTL,
} from '../constants';

/**
 * Cron handler: iterate all channels, check due sources, send new posts.
 */
export async function checkAllFeeds(env: Env): Promise<void> {
// ... (skipping unchanged code for brevity in my thought, but I must provide full context in replace)

	const channelsRaw = await getCached(env.CACHE, CACHE_KEY_TELEGRAM_CHANNELS);
	if (!channelsRaw) return;

	const channels: string[] = JSON.parse(channelsRaw);
	if (channels.length === 0) return;

	const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
	const now = Date.now();

	for (const channelId of channels) {
		try {
			await checkChannel(channelId, now, bot, env);
		} catch (err) {
			console.error(`Error checking channel ${channelId}:`, err);
		}
	}
}

async function checkChannel(channelId: string, now: number, bot: Bot, env: Env): Promise<void> {
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
			await checkSource(channelId, source, bot, env, config);
		} catch (err) {
			console.error(`Error checking source ${source.value} for channel ${channelId}:`, err);
		}
	}
}

async function checkSource(channelId: string, source: ChannelSource, bot: Bot, env: Env, config: ChannelConfig): Promise<void> {
	const result = await fetchForSource(source, env);
	if (result.items.length === 0) {
		if (result.errors.length > 0) {
			console.error(`[Cron] All tiers failed for ${source.value}:`, JSON.stringify(result.errors));
		}
		return;
	}

	// Filter by media type
	const items = filterItems(result.items, migrateMediaFilter(source));
	if (items.length === 0) return;

	// Get last seen item ID
	const lastSeenKey = `${CACHE_PREFIX_TELEGRAM_LASTSEEN}${channelId}:${source.id}`;
	const lastSeenId = await getCached(env.CACHE, lastSeenKey);

	// Find new items (items more recent than last seen)
	const newItems: FeedItem[] = [];
	for (const item of items) {
		if (item.id === lastSeenId) break;
		newItems.push(item);
	}

	if (newItems.length === 0) return;

	// Send oldest first
	newItems.reverse();

	// Limit to 5 posts per check to avoid flooding
	const postsToSend = newItems.slice(0, 5);
	const chatId = parseInt(channelId, 10);

	// Resolve format settings: hardcoded < channel defaults < source overrides
	const settings = resolveFormatSettings(config.defaultFormat, source.format);

	for (const item of postsToSend) {
		try {
			const message = formatFeedItem(item, settings);
			await sendMediaToChannel(bot, chatId, message, settings);
		} catch (err) {
			console.error(`Failed to send item ${item.id} to ${channelId}:`, err);
			// Fallback: send thumbnail + link
			try {
				await sendFallbackMessage(bot, chatId, item);
			} catch (fallbackErr) {
				console.error(`Fallback also failed for ${item.id}:`, fallbackErr);
			}
		}
	}

	// Update last seen to the most recent item actually sent
	if (postsToSend.length > 0) {
		const lastSentItem = postsToSend[postsToSend.length - 1];
		await setCached(env.CACHE, lastSeenKey, lastSentItem.id, TELEGRAM_CONFIG_TTL);
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
