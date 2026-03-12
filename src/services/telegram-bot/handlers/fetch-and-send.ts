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
				try {
					await bot.api.sendMessage(
						chatId,
						`Failed to fetch for <b>${escapeHtmlBot(source.value)}</b>:\n\n<pre>${errorSummary}</pre>`,
						{ parse_mode: 'HTML' }
					);
				} catch (sendErr) {
					console.error('Failed to send error notification:', sendErr);
				}
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
					await sendFallbackMessage(bot, chatId, item);
				} catch (fallbackErr) {
					console.error(`Fallback also failed for ${item.id}:`, fallbackErr);
					await addFailedPost(env.CACHE, String(chatId), item);
					if (fallbackErr instanceof FileTooLargeError && !isNaN(adminId)) {
						await bot.api.sendMessage(adminId,
							`<b>File too large for Telegram!</b>\nChannel: <code>${chatId}</code>\nSource: <code>${source.value}</code>\n\nDirect URL: <a href="${fallbackErr.url}">Download here</a>`,
							{ parse_mode: 'HTML' }
						);
					}
				}
			}
		}
		if (failures > 0 && settings.fallbackMode !== 'skip') {
			try {
				await bot.api.sendMessage(chatId, `⚠️ ${failures}/${items.length} post(s) sent as fallback (thumbnail + link).`);
			} catch (_) { /* best effort */ }
		} else if (failures > 0 && settings.fallbackMode === 'skip') {
			try {
				await bot.api.sendMessage(chatId, `⚠️ ${failures}/${items.length} post(s) skipped due to media errors (see Failed Posts in settings).`);
			} catch (_) { /* best effort */ }
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
			await bot.api.sendMessage(chatId, `⚠️ Failed to fetch initial posts for ${escapeHtmlBot(source.value)}. The subscription was saved but the first fetch failed.`, { parse_mode: 'HTML' });
		} catch (notifyErr) {
			console.error('Failed to notify admin of fetchAndSendLatest failure:', notifyErr);
		}
	}
}
