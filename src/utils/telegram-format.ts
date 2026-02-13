import type { FeedItem } from '../types/feed';
import type { FormatSettings, TelegramMediaMessage } from '../types/telegram';
import { DEFAULT_FORMAT_SETTINGS } from '../constants';

/**
 * Merge hardcoded defaults < channel defaults < source overrides.
 */
export function resolveFormatSettings(
	channelDefaults?: Partial<FormatSettings>,
	sourceOverrides?: Partial<FormatSettings>
): FormatSettings {
	return {
		...DEFAULT_FORMAT_SETTINGS,
		...channelDefaults,
		...sourceOverrides,
	};
}

/**
 * Convert a FeedItem into a Telegram-ready message structure.
 * Uses HTML parse mode for captions (supports <a>, <b>, <i> tags).
 */
export function formatFeedItem(item: FeedItem, settings?: FormatSettings): TelegramMediaMessage {
	const resolved = settings ?? DEFAULT_FORMAT_SETTINGS;

	// 'only_media' sends media with footer only (no caption body)
	const caption = resolved.media === 'only_media'
		? buildFooter(item, resolved)
		: buildTelegramCaption(item, resolved);

	// 'disable' sends text-only message with no media
	if (resolved.media === 'disable') {
		return { type: 'text', caption };
	}

	switch (item.mediaType) {
		case 'photo':
			return { type: 'photo', url: item.media[0]?.url, caption };

		case 'video':
			return {
				type: 'video',
				url: item.media[0]?.url,
				thumbnailUrl: item.media[0]?.thumbnailUrl,
				caption,
			};

		case 'album': {
			if (item.media.length === 0) {
				return { type: 'text', caption };
			}
			const media = item.media.map((m, idx) => ({
				type: m.type,
				media: m.url,
				// Only first item gets caption in a media group
				...(idx === 0 ? { caption, parse_mode: 'HTML' } : {}),
			}));
			return { type: 'mediagroup', media, caption };
		}

		case 'none':
		default:
			return { type: 'text', caption };
	}
}

function buildTelegramCaption(item: FeedItem, settings: FormatSettings): string {
	let text = escapeHtml(item.text);

	// Instagram-specific: link @mentions and #hashtags to Instagram URLs
	if (isInstagramItem(item)) {
		text = text.replace(/@([\w.]+)/g, '<a href="https://www.instagram.com/$1">@$1</a>');
		text = text.replace(/#([\w]+)/g, '<a href="https://www.instagram.com/explore/tags/$1">#$1</a>');
	}

	const footer = buildFooter(item, settings);

	// Telegram limits: 1024 for media captions, 4096 for text messages
	const telegramLimit = settings.media === 'disable' || item.mediaType === 'none' ? 4096 : 1024;
	const effectiveLimit = settings.lengthLimit > 0
		? Math.min(settings.lengthLimit, telegramLimit)
		: telegramLimit;
	const maxCaptionBody = effectiveLimit - footer.length;

	if (text.length > maxCaptionBody) {
		text = text.substring(0, maxCaptionBody - 1) + '\u2026';
	}

	return text + footer;
}

function buildFooter(item: FeedItem, settings: FormatSettings): string {
	const showAuthor = settings.author === 'enable' && item.author;
	const postUrl = item.link;
	const sourceName = item.feedTitle || 'Source';

	switch (settings.sourceFormat) {
		case 'title_link':
			return showAuthor
				? `\n\n<a href="${postUrl}">View on ${escapeHtml(sourceName)}</a> | ${escapeHtml(item.author)}`
				: `\n\n<a href="${postUrl}">View on ${escapeHtml(sourceName)}</a>`;
		case 'link_only':
			return showAuthor
				? `\n\n<a href="${postUrl}">${escapeHtml(item.author)} \u2014 ${escapeHtml(sourceName)}</a>`
				: `\n\n<a href="${postUrl}">${escapeHtml(sourceName)}</a>`;
		case 'bare_url':
			return showAuthor
				? `\n\n${escapeHtml(item.author)}\n${postUrl}`
				: `\n\n${postUrl}`;
		case 'disable':
			return showAuthor ? `\n\n${escapeHtml(item.author)}` : '';
	}
}

function isInstagramItem(item: FeedItem): boolean {
	return item.link.includes('instagram.com') || item.feedLink.includes('instagram.com');
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
