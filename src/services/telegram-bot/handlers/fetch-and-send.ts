import type { Bot } from 'grammy';
import type { ChannelSource } from '../../../types/telegram';
import { fetchForSource } from '../../source-fetcher';
import { formatFeedItem, resolveFormatSettings } from '../../../utils/telegram-format';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';
import { getCached, setCached } from '../../../utils/cache';
import { CACHE_PREFIX_TELEGRAM_SENT, TELEGRAM_CONFIG_TTL } from '../../../constants';
import { sendMediaToChannel, FileTooLargeError } from './send-media';
import { sendFallbackMessage } from '../helpers/fallback-sender';
import { enrichFeedItems } from '../../../utils/media-enrichment';
import { getChannelConfig, addFailedPost } from '../storage/kv-operations';

/**
 * Send an alert DM to the admin. Silently fails if notification itself errors.
 */
async function alertAdmin(bot: Bot, adminId: number, message: string): Promise<void> {
	if (isNaN(adminId)) return;
	try {
		await bot.api.sendMessage(adminId, message, { parse_mode: 'HTML' });
	} catch (e) {
		console.error('[Alert] Failed to notify admin:', e);
	}
}

/**
 * Fetch latest posts from a source and send them to a channel.
 * Primarily used when a new source is added (initial fetch).
 */
export async function fetchAndSendLatest(
	bot: Bot,
	env: Env,
	chatId: number,
	source: ChannelSource,
	count: number = 1
): Promise<void> {
	const adminId = parseInt(env.ADMIN_TELEGRAM_ID, 10);
	try {
		const config = await getChannelConfig(env.CACHE, String(chatId));
		const settings = resolveFormatSettings(config?.defaultFormat, source.format);

		const result = await fetchForSource(source, env);
		if (result.items.length === 0) {
			if (result.errors.length > 0) {
				const errorSummary = result.errors
					.map((e) => `- ${e.tier}: ${e.message}${e.status ? ` (HTTP ${e.status})` : ''}`)
					.join('\n');
				await alertAdmin(bot, adminId,
					`❌ <b>Couldn't fetch updates</b>\nSource: <code>${escapeHtmlBot(source.value)}</code>\nChannel: <code>${chatId}</code>\n\n<pre>${errorSummary}</pre>`
				);
			}
			return;
		}

		// Send latest posts (oldest first)
		const items = result.items.slice(0, count).reverse();

		// Enrich items that link to supported platforms (e.g. TikTok) but have no media
		await enrichFeedItems(items);

		let failures = 0;
		for (const item of items) {
			try {
				const message = formatFeedItem(item, settings);
				await sendMediaToChannel(bot, chatId, message, settings);
			} catch (err) {
				failures++;
				console.error(`Failed to send item ${item.id}:`, err);

				// Check fallback setting
				if (settings.fallbackMode === 'skip') {
					console.log(`[Manual] Skipping fallback for ${item.id} as per settings`);
					await addFailedPost(env.CACHE, String(chatId), item);
					continue;
				}

				// Fallback: send thumbnail + link
				try {
					await sendFallbackMessage(bot, chatId, item, settings.fallbackMode as 'thumbnail_link' | 'thumbnail');
				} catch (fallbackErr) {
					console.error(`Fallback also failed for ${item.id}:`, fallbackErr);
					await addFailedPost(env.CACHE, String(chatId), item);
					if (fallbackErr instanceof FileTooLargeError && !isNaN(adminId)) {
						await alertAdmin(bot, adminId,
							`❌ <b>File is too large for Telegram</b>\nChannel: <code>${chatId}</code>\nSource: <code>${source.value}</code>\n\nDirect URL: <a href="${fallbackErr.url}">Download here</a>`
						);
					}
				}
			}
		}
		
		// Notify admin of results (never send status summaries to the channel)
		if (failures > 0) {
			const action = settings.fallbackMode === 'skip' ? 'skipped' : 'sent as fallback';
			await alertAdmin(bot, adminId,
				`ℹ️ <b>Sync results for ${chatId}</b>\nSource: <code>${source.value}</code>\n${failures}/${items.length} post(s) ${action}.`
			);
		}

		// Save sent links so cron doesn't re-send
		const sentKey = `${CACHE_PREFIX_TELEGRAM_SENT}${chatId}:${source.id}`;
		try {
			const sentRaw = await getCached(env.CACHE, sentKey);
			let sentLinks: string[] = [];
			try {
				const parsed = sentRaw ? JSON.parse(sentRaw) : [];
				if (Array.isArray(parsed)) sentLinks = parsed;
			} catch { /* start fresh */ }
			const newLinks = result.items.slice(0, count).map(item => item.link);
			const merged = [...sentLinks, ...newLinks].slice(-50);
			await setCached(env.CACHE, sentKey, JSON.stringify(merged), TELEGRAM_CONFIG_TTL);
		} catch (err) {
			console.error(`Failed to save sent links for ${source.value}:`, err);
		}
	} catch (err) {
		console.error(`fetchAndSendLatest error for ${source.value}:`, err);
		try {
			await bot.api.sendMessage(chatId, `⚠️ I couldn't fetch the latest posts for <b>${escapeHtmlBot(source.value)}</b>. The subscription was saved, but the first attempt failed. Check the logs or source URL and try again.`, { parse_mode: 'HTML' });
		} catch (notifyErr) {
			console.error('Failed to notify admin of fetchAndSendLatest failure:', notifyErr);
		}
	}
}
