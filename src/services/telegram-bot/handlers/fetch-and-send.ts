import type { Bot } from 'grammy';
import type { ChannelSource } from '../../../types/telegram';
import { fetchForSource } from '../../instagram-fetcher';
import { formatFeedItem } from '../../../utils/telegram-format';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';
import { setCached } from '../../../utils/cache';
import { CACHE_PREFIX_TELEGRAM_LASTSEEN, TELEGRAM_CONFIG_TTL } from '../../../constants';
import { sendMediaToChannel } from './send-media';

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
		for (const item of items) {
			try {
				const message = formatFeedItem(item);
				await sendMediaToChannel(bot, chatId, message);
			} catch (err) {
				console.error(`Failed to send item ${item.id}:`, err);
			}
		}

		// Set lastseen to most recent item so cron doesn't re-send
		const lastSeenKey = `${CACHE_PREFIX_TELEGRAM_LASTSEEN}${chatId}:${source.id}`;
		await setCached(env.CACHE, lastSeenKey, result.items[0].id, TELEGRAM_CONFIG_TTL);
	} catch (err) {
		console.error(`fetchAndSendLatest error for ${source.value}:`, err);
	}
}
