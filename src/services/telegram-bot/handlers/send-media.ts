import { GrammyError, InputFile, InputMediaBuilder } from 'grammy';
import type { Bot } from 'grammy';
import type { TelegramMediaMessage, FormatSettings } from '../../../types/telegram';

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB Telegram bot upload limit
const MEDIA_CAPTION_LIMIT = 1024; // Telegram caption limit for photo/video/audio/mediagroup

/** Thrown when Telegram rejects a URL (can't fetch it). Caller decides how to handle. */
export class TelegramUrlFetchError extends Error {
	constructor(public readonly mediaUrl: string) {
		super(`Telegram could not fetch URL: ${mediaUrl}`);
	}
}

function isTelegramUrlError(err: unknown): boolean {
	return (
		err instanceof GrammyError &&
		(err.description.includes('failed to get HTTP URL') ||
			err.description.includes('wrong file identifier'))
	);
}

/** If caption fits, attach it to media. If too long, send media without caption then post caption as separate text. */
async function sendWithCaption(
	send: (caption: string) => Promise<unknown>,
	bot: Bot,
	chatId: number,
	caption: string | undefined,
	disableNotification: boolean
): Promise<void> {
	const text = caption || '';
	if (text.length <= MEDIA_CAPTION_LIMIT) {
		await send(text);
	} else {
		await send('');
		await bot.api.sendMessage(chatId, text, {
			parse_mode: 'HTML',
			disable_notification: disableNotification,
		});
	}
}

/**
 * Send a formatted media message to a Telegram chat.
 * Handles text, photo, video, audio, and media group types.
 *
 * @param interactive When true, throws TelegramUrlFetchError on URL rejection (for user-facing
 *   download flow). When false (default), auto-falls back to download+upload silently (for cron).
 */
export async function sendMediaToChannel(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	settings?: FormatSettings,
	interactive = false
): Promise<void> {
	const disableNotification = settings?.notification === 'muted';

	switch (message.type) {
		case 'text':
			await sendTextMessage(bot, chatId, message, disableNotification, settings);
			break;
		case 'photo':
			await sendPhotoMessage(bot, chatId, message, disableNotification, interactive);
			break;
		case 'video':
			await sendVideoMessage(bot, chatId, message, disableNotification, interactive);
			break;
		case 'audio':
			await sendAudioMessage(bot, chatId, message, disableNotification, interactive);
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
	disableNotification: boolean,
	interactive: boolean
): Promise<void> {
	if (!message.url) throw new Error('Photo URL is missing');
	const url = message.url;
	try {
		await sendWithCaption(
			(caption) => bot.api.sendPhoto(chatId, url, { caption, parse_mode: 'HTML', disable_notification: disableNotification }),
			bot, chatId, message.caption, disableNotification
		);
	} catch (err) {
		if (!isTelegramUrlError(err)) throw err;
		if (interactive) throw new TelegramUrlFetchError(url);
		const file = await downloadAsInputFile(url, 'photo.jpg');
		await sendWithCaption(
			(caption) => bot.api.sendPhoto(chatId, file, { caption, parse_mode: 'HTML', disable_notification: disableNotification }),
			bot, chatId, message.caption, disableNotification
		);
	}
}

async function sendVideoMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean,
	interactive: boolean
): Promise<void> {
	if (!message.url) throw new Error('Video URL is missing');
	const url = message.url;
	try {
		await sendWithCaption(
			(caption) => bot.api.sendVideo(chatId, url, { caption, parse_mode: 'HTML', disable_notification: disableNotification }),
			bot, chatId, message.caption, disableNotification
		);
	} catch (err) {
		if (!isTelegramUrlError(err)) throw err;
		if (interactive) throw new TelegramUrlFetchError(url);
		const file = await downloadAsInputFile(url, 'video.mp4');
		await sendWithCaption(
			(caption) => bot.api.sendVideo(chatId, file, { caption, parse_mode: 'HTML', disable_notification: disableNotification }),
			bot, chatId, message.caption, disableNotification
		);
	}
}

async function sendAudioMessage(
	bot: Bot,
	chatId: number,
	message: TelegramMediaMessage,
	disableNotification: boolean,
	interactive: boolean
): Promise<void> {
	if (!message.url) throw new Error('Audio URL is missing');
	const url = message.url;
	try {
		await sendWithCaption(
			(caption) => bot.api.sendAudio(chatId, url, { caption, parse_mode: 'HTML', disable_notification: disableNotification }),
			bot, chatId, message.caption, disableNotification
		);
	} catch (err) {
		if (!isTelegramUrlError(err)) throw err;
		if (interactive) throw new TelegramUrlFetchError(url);
		const file = await downloadAsInputFile(url, 'audio.mp3');
		await sendWithCaption(
			(caption) => bot.api.sendAudio(chatId, file, { caption, parse_mode: 'HTML', disable_notification: disableNotification }),
			bot, chatId, message.caption, disableNotification
		);
	}
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
			// Always try URL first; if Telegram rejects it, fall back to download+upload
			let source: string | InputFile = item.media;
			try {
				// Validate by attempting a dummy resolve — actual rejection caught during sendMediaGroup
				source = item.media;
			} catch {
				source = await downloadAsInputFile(item.media, `media.${ext}`);
			}
			const opts = { caption: item.caption, parse_mode: item.parse_mode as 'HTML' | undefined };
			return item.type === 'video'
				? InputMediaBuilder.video(source, opts)
				: InputMediaBuilder.photo(source, opts);
		})
	);

	try {
		await bot.api.sendMediaGroup(chatId, resolvedMedia, {
			disable_notification: disableNotification,
		});
	} catch (err) {
		if (!isTelegramUrlError(err)) throw err;
		// Re-resolve all items as uploaded files and retry
		const uploadedMedia = await Promise.all(
			message.media.slice(0, 10).map(async (item) => {
				const ext = item.type === 'video' ? 'mp4' : 'jpg';
				const file = await downloadAsInputFile(item.media, `media.${ext}`);
				const opts = { caption: item.caption, parse_mode: item.parse_mode as 'HTML' | undefined };
				return item.type === 'video'
					? InputMediaBuilder.video(file, opts)
					: InputMediaBuilder.photo(file, opts);
			})
		);
		await bot.api.sendMediaGroup(chatId, uploadedMedia, {
			disable_notification: disableNotification,
		});
	}
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
