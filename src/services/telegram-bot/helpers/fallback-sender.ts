import type { Bot } from 'grammy';
import type { FeedItem } from '../../../types/feed';
import { escapeHtml as escapeHtmlBot } from '../../../utils/text';

/**
 * Send a fallback message when the original media fails.
 * Tries to send thumbnail (if available) with caption + link, or just text with link.
 */
export async function sendFallbackMessage(bot: Bot, chatId: number, item: FeedItem): Promise<void> {
	const thumbnail = item.media[0]?.thumbnailUrl;
	const link = item.link;
	const caption = item.text
		? `${escapeHtmlBot(item.text.substring(0, 200))}${item.text.length > 200 ? '...' : ''}\n\n<a href="${link}">View original post</a>`
		: `<a href="${link}">View original post</a>`;

	if (thumbnail) {
		// Send thumbnail image with caption + link
		await bot.api.sendPhoto(chatId, thumbnail, {
			caption,
			parse_mode: 'HTML',
		});
	} else {
		// No thumbnail, send text with link
		await bot.api.sendMessage(chatId, caption, {
			parse_mode: 'HTML',
		});
	}
}
