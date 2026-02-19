import { InputFile, InputMediaBuilder } from 'grammy';
import type { Bot } from 'grammy';
import type { TelegramMediaMessage, FormatSettings } from '../../../types/telegram';

const URL_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB — above this, Telegram needs upload instead of URL
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB Telegram bot upload limit

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
		case 'audio':
			await sendAudioMessage(bot, chatId, message, disableNotification);
			break;
		case 'mediagroup':
			await sendMediaGroupMessage(bot, chatId, message, disableNotification);
			break;
		default:
			console.error(`[sendMedia] Unknown message type: ${(message as any).type}`);
			throw new Error(`Unknown message type: ${(message as any).type}`);
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
	const opts = {
		caption: message.caption,
		parse_mode: 'HTML' as const,
		disable_notification: disableNotification,
	};
	const source = await resolveMedia(message.url, 'photo.jpg');
	await bot.api.sendPhoto(chatId, source, opts);
}

async function sendVideoMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean
): Promise<void> {
	if (!message.url) throw new Error('Video URL is missing');
	const opts = {
		caption: message.caption,
		parse_mode: 'HTML' as const,
		disable_notification: disableNotification,
	};
	const source = await resolveMedia(message.url, 'video.mp4');
	await bot.api.sendVideo(chatId, source, opts);
}

async function sendMediaGroupMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean
): Promise<void> {
	if (!message.media || message.media.length === 0) {
		console.warn(`[sendMedia] mediagroup message has no media items for chat ${chatId}, skipping`);
		return;
	}

	const resolvedMedia = await Promise.all(
		message.media.map(async (item) => {
			const ext = item.type === 'video' ? 'mp4' : 'jpg';
			const source = await resolveMedia(item.media, `media.${ext}`);
			const opts = { caption: item.caption, parse_mode: item.parse_mode as 'HTML' | undefined };
			return item.type === 'video'
				? InputMediaBuilder.video(source, opts)
				: InputMediaBuilder.photo(source, opts);
		})
	);

	await bot.api.sendMediaGroup(chatId, resolvedMedia, {
		disable_notification: disableNotification,
	});
}

/** Hosts that Telegram can fetch directly — everything else gets downloaded+uploaded */
const TELEGRAM_FRIENDLY_HOSTS = ['cdninstagram.com', 'fbcdn.net', 'pbs.twimg.com', 'twimg.com', 'tokcdn.com', 'telegram.org', 't.me'];

/**
 * Resolve a media URL for Telegram. URLs from known Telegram-friendly CDNs are passed through;
 * all other URLs are downloaded and uploaded as files to avoid "failed to get HTTP URL content".
 */
async function resolveMedia(url: string, filename: string): Promise<string | InputFile> {
	const isTelegramFriendly = TELEGRAM_FRIENDLY_HOSTS.some(host => url.includes(host));

	if (isTelegramFriendly) {
		const size = await getFileSize(url);
		if (size !== null && size <= URL_SIZE_LIMIT) {
			return url;
		}
	}

	// Download+upload for all third-party CDN URLs
	return downloadAsInputFile(url, filename);
}

async function getFileSize(url: string): Promise<number | null> {
	try {
		const resp = await fetch(url, { method: 'HEAD' });
		if (!resp.ok) return null;
		const cl = resp.headers.get('content-length');
		return cl ? Number(cl) : null;
	} catch {
		return null;
	}
}

async function sendAudioMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean
): Promise<void> {
	if (!message.url) throw new Error('Audio URL is missing');
	const opts = {
		caption: message.caption,
		parse_mode: 'HTML' as const,
		disable_notification: disableNotification,
	};
	const source = await resolveMedia(message.url, 'audio.mp3');
	await bot.api.sendAudio(chatId, source, opts);
}

async function downloadAsInputFile(url: string, filename: string): Promise<InputFile> {
	const resp = await fetch(url, {
		headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
		signal: AbortSignal.timeout(45_000),
	});
	if (!resp.ok) throw new Error(`Failed to download media: ${resp.status}`);

	const contentLength = Number(resp.headers.get('content-length') || 0);
	if (contentLength > MAX_UPLOAD_SIZE) {
		throw new Error(`File too large (${(contentLength / 1024 / 1024).toFixed(1)}MB) — Telegram limit is 50MB`);
	}

	const bytes = new Uint8Array(await resp.arrayBuffer());
	if (bytes.length > MAX_UPLOAD_SIZE) {
		throw new Error(`File too large (${(bytes.length / 1024 / 1024).toFixed(1)}MB) — Telegram limit is 50MB`);
	}

	return new InputFile(bytes, filename);
}
