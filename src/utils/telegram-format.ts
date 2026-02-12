import type { MediaNode } from '../types/instagram';
import type { TelegramMediaMessage } from '../types/telegram';
import { IG_BASE_URL } from '../constants';

/**
 * Convert a MediaNode into a Telegram-ready message structure.
 * Uses HTML parse mode for captions (supports <a>, <b>, <i> tags).
 */
export function formatMediaForTelegram(node: MediaNode): TelegramMediaMessage {
	const postUrl = `${IG_BASE_URL}/p/${node.shortcode}/`;
	const caption = buildTelegramCaption(node, postUrl);

	switch (node.__typename) {
		case 'GraphImage':
			return { type: 'photo', url: node.display_url, caption };

		case 'GraphVideo':
			return {
				type: 'video',
				url: node.video_url || node.display_url,
				thumbnailUrl: node.display_url,
				caption,
			};

		case 'GraphSidecar': {
			const children = node.edge_sidecar_to_children?.edges || [];
			if (children.length === 0) {
				return { type: 'photo', url: node.display_url, caption };
			}

			const media = children.map((edge, idx) => ({
				type: (edge.node.is_video ? 'video' : 'photo') as 'photo' | 'video',
				media: edge.node.is_video ? (edge.node.video_url || edge.node.display_url) : edge.node.display_url,
				// Only first item gets caption in a media group
				...(idx === 0 ? { caption, parse_mode: 'HTML' } : {}),
			}));

			return { type: 'mediagroup', media, caption };
		}
	}
}

function buildTelegramCaption(node: MediaNode, postUrl: string): string {
	const rawCaption = node.edge_media_to_caption.edges[0]?.node.text || '';
	const author = node.owner.username;

	let text = escapeHtml(rawCaption);

	// Link @mentions (Telegram HTML)
	text = text.replace(/@([\w.]+)/g, '<a href="https://www.instagram.com/$1">@$1</a>');

	// Link #hashtags
	text = text.replace(/#([\w]+)/g, '<a href="https://www.instagram.com/explore/tags/$1">#$1</a>');

	// Telegram caption limit is 1024 chars — truncate if needed
	const footer = `\n\n<a href="${postUrl}">View on Instagram</a> | @${author}`;
	const maxCaptionBody = 1024 - footer.length;

	if (text.length > maxCaptionBody) {
		text = text.substring(0, maxCaptionBody - 1) + '\u2026';
	}

	return text + footer;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
