import { InputMediaBuilder } from 'grammy';
import type { Bot } from 'grammy';
import type { TelegramMediaMessage, FormatSettings } from '../../../types/telegram';

/**
 * Send a formatted media message to a Telegram chat.
 * Handles text, photo, video, and media group types.
 */
export async function sendMediaToChannel(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	settings?: FormatSettings
): Promise<void> {
	const disableNotification = settings?.notification === 'muted';

	switch (message.type) {
		case 'text':
			await sendTextMessage(bot, chatId, message, disableNotification, settings);
			break;
		case 'photo':
			await sendPhotoMessage(bot, chatId, message, disableNotification);
			break;
		case 'video':
			await sendVideoMessage(bot, chatId, message, disableNotification);
			break;
		case 'mediagroup':
			await sendMediaGroupMessage(bot, chatId, message, disableNotification);
			break;
	}
}

async function sendTextMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean,
	settings?: FormatSettings
): Promise<void> {
	await bot.api.sendMessage(chatId, message.caption, {
		parse_mode: 'HTML',
		disable_notification: disableNotification,
		link_preview_options: settings?.linkPreview === 'disable' ? { is_disabled: true } : undefined,
	});
}

async function sendPhotoMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean
): Promise<void> {
	if (!message.url) throw new Error('Photo URL is missing');
	await bot.api.sendPhoto(chatId, message.url, {
		caption: message.caption,
		parse_mode: 'HTML',
		disable_notification: disableNotification,
	});
}

async function sendVideoMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean
): Promise<void> {
	if (!message.url) throw new Error('Video URL is missing');
	await bot.api.sendVideo(chatId, message.url, {
		caption: message.caption,
		parse_mode: 'HTML',
		disable_notification: disableNotification,
	});
}

async function sendMediaGroupMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean
): Promise<void> {
	if (!message.media || message.media.length === 0) return;

	const media = message.media.map((item) => {
		if (item.type === 'video') {
			return InputMediaBuilder.video(item.media, {
				caption: item.caption,
				parse_mode: item.parse_mode as 'HTML' | undefined,
			});
		}
		return InputMediaBuilder.photo(item.media, {
			caption: item.caption,
			parse_mode: item.parse_mode as 'HTML' | undefined,
		});
	});

	await bot.api.sendMediaGroup(chatId, media, {
		disable_notification: disableNotification,
	});
}
