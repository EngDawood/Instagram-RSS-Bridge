import type { Bot } from 'grammy';
import type { ChannelSource } from '../../../types/telegram';
import { fetchForSource } from '../../source-fetcher';
import { formatFeedItem } from '../../../utils/telegram-format';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';
import { setCached } from '../../../utils/cache';
import { CACHE_PREFIX_TELEGRAM_LASTSEEN, TELEGRAM_CONFIG_TTL } from '../../../constants';
import { sendMediaToChannel } from './send-media';
import { sendFallbackMessage } from '../helpers/fallback-sender';

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
	try {
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
		let failures = 0;
		for (const item of items) {
			try {
				const message = formatFeedItem(item);
				await sendMediaToChannel(bot, chatId, message);
			} catch (err) {
				failures++;
				console.error(`Failed to send item ${item.id}:`, err);
				// Fallback: send thumbnail + link
				try {
					await sendFallbackMessage(bot, chatId, item);
				} catch (fallbackErr) {
					console.error(`Fallback also failed for ${item.id}:`, fallbackErr);
				}
			}
		}
		if (failures > 0) {
			try {
				await bot.api.sendMessage(chatId, `⚠️ ${failures}/${items.length} post(s) sent as fallback (thumbnail + link).`);
			} catch (_) { /* best effort */ }
		}

		// Set lastseen to most recent item so cron doesn't re-send
		const lastSeenKey = `${CACHE_PREFIX_TELEGRAM_LASTSEEN}${chatId}:${source.id}`;
		try {
			await setCached(env.CACHE, lastSeenKey, result.items[0].id, TELEGRAM_CONFIG_TTL);
		} catch (err) {
			console.error(`Failed to save lastseen for ${source.value}:`, err);
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
