import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import { downloadMedia, formatFileSize } from '../../media-downloader';
import { sendMediaToChannel, TelegramUrlFetchError } from './send-media';
import { setAdminState } from '../storage/admin-state';
import type { TelegramMediaMessage } from '../../../types/telegram';

/**
 * Download media from a URL and send it to a chat.
 * Used by both direct text input and callback buttons.
 *
 * @param directUrl When true, treat `url` as a direct media URL (skip platform detection)
 * @param options   When provided with kv + adminId, enables interactive mode:
 *                  if Telegram can't fetch the URL directly, shows a Download/Cancel picker
 *                  instead of auto-downloading through the Worker.
 */
export async function downloadAndSendMedia(
	bot: Bot,
	chatId: number,
	url: string,
	platform: string,
	mode: 'auto' | 'audio' | 'hd' | 'sd' = 'auto',
	statusMessageId?: number,
	directUrl?: boolean,
	options?: { kv?: KVNamespace; adminId?: number }
): Promise<void> {
	const interactive = !!(options?.kv && options?.adminId);
	const modeText = mode === 'audio' ? 'audio' : 'media';
	const statusText = `Downloading ${modeText} from ${platform}...`;

	if (statusMessageId) {
		try {
			await bot.api.editMessageText(chatId, statusMessageId, statusText);
		} catch (e) {
			// Edit failed — send a new message and track its ID instead
			const fallback = await bot.api.sendMessage(chatId, statusText);
			statusMessageId = fallback.message_id;
		}
	} else {
		const msg = await bot.api.sendMessage(chatId, statusText);
		statusMessageId = msg.message_id;
	}

	try {
		// If directUrl, send the URL directly as a video (used for YouTube quality selection)
		if (directUrl) {
			const msg: TelegramMediaMessage = { type: 'video', url, caption: '' };
			await sendMediaToChannel(bot, chatId, msg, undefined, interactive);
			await bot.api.editMessageText(chatId, statusMessageId!, 'Done.');
			return;
		}

		const result = await downloadMedia(url, mode);

		if (result.status === 'error') {
			await bot.api.editMessageText(chatId, statusMessageId!, `Download failed: ${result.error || 'unknown error'}`);
			return;
		}

		if (result.media && result.media.length > 0) {
			const caption = result.caption || '';
			// Build size/quality info for the "Done" message
			const sizeInfo = result.media
				.map(m => {
					const parts: string[] = [];
					if (m.quality) parts.push(m.quality);
					if (m.filesize) parts.push(formatFileSize(m.filesize));
					return parts.join(' ');
				})
				.filter(Boolean)
				.join(', ');
			const doneText = sizeInfo ? `Done. (${sizeInfo})` : 'Done.';

			if (result.media.length > 1) {
				const groupableItems = result.media.filter(m => m.type === 'photo' || m.type === 'video');

				if (groupableItems.length > 1) {
					const msg: TelegramMediaMessage = {
						type: 'mediagroup',
						caption: caption,
						media: groupableItems.slice(0, 10).map((item, index) => ({
							type: item.type as 'photo' | 'video',
							media: item.url,
							caption: index === 0 ? caption : '',
							parse_mode: 'HTML',
						})),
					};
					await sendMediaToChannel(bot, chatId, msg, undefined, interactive);
					await bot.api.editMessageText(chatId, statusMessageId!, `Sent ${Math.min(groupableItems.length, 10)} items as album.`);
				} else {
					for (const item of result.media.slice(0, 10)) {
						const msg: TelegramMediaMessage = {
							type: item.type,
							url: item.url,
							caption: caption,
						};
						await sendMediaToChannel(bot, chatId, msg, undefined, interactive);
					}
					await bot.api.editMessageText(chatId, statusMessageId!, doneText);
				}
			} else {
				const item = result.media[0];
				const msg: TelegramMediaMessage = {
					type: item.type,
					url: item.url,
					caption: caption,
				};
				await sendMediaToChannel(bot, chatId, msg, undefined, interactive);
				await bot.api.editMessageText(chatId, statusMessageId!, doneText);
			}
			return;
		}

		await bot.api.editMessageText(chatId, statusMessageId!, 'No media found.');
	} catch (err: any) {
		// Telegram couldn't fetch the URL directly — show picker in interactive mode
		if (err instanceof TelegramUrlFetchError && options?.kv && options?.adminId) {
			await setAdminState(options.kv, options.adminId, {
				action: 'downloading_media',
				context: {
					downloadUrl: url,
					downloadPlatform: platform,
					directMediaUrl: err.mediaUrl,
				},
			});
			const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(err.mediaUrl)}`;
			const keyboard = new InlineKeyboard()
				.text('📥 Download', 'dl:confirm')
				.text('❌ Cancel', 'dl:cancel')
				.row()
				.url('📤 Send to @urluploadxbot', shareUrl);
			await bot.api.editMessageText(
				chatId,
				statusMessageId!,
				`Telegram can't fetch this file directly.\n\n<code>${err.mediaUrl}</code>`,
				{ parse_mode: 'HTML', reply_markup: keyboard }
			);
			return;
		}

		console.error('[downloader] Download and send error:', err);
		const msg = err.message || 'Unknown error';
		// If file is too large for Telegram, send the link as text instead
		if (msg.includes('too large') || msg.includes('Too large')) {
			const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}`;
			const keyboard = new InlineKeyboard()
				.url('📤 Send to @urluploadxbot', shareUrl);
			await bot.api.editMessageText(
				chatId,
				statusMessageId!,
				`File too large for Telegram (>50MB).\n\n<code>${url}</code>`,
				{ parse_mode: 'HTML', reply_markup: keyboard }
			);
		} else {
			await bot.api.editMessageText(chatId, statusMessageId!, `Error: ${msg}`);
		}
	}
}
