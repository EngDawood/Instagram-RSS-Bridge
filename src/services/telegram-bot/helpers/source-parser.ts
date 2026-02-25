import type { SourceType } from '../../../types/telegram';

/**
 * Generate a short hash for a URL to use as source ID suffix.
 */
export function shortHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
	}
	return Math.abs(hash).toString(36);
}

/**
 * Parse a source reference string into structured type/value/id.
 * @param ref - Source reference: URL, #hashtag, or @username
 * @returns Parsed source object or null if invalid
 */
export function parseSourceRef(ref: string): { type: SourceType; value: string; id: string } | null {
	if (!ref || typeof ref !== 'string') return null;

	const trimmed = ref.trim();

	// RSS/Atom URL
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		return { type: 'rss_url', value: trimmed, id: `rss_${shortHash(trimmed)}` };
	}

	// Instagram hashtag
	if (trimmed.startsWith('#')) {
		const value = trimmed.replace(/^#/, '');
		if (!value) return null; // Prevent empty hashtag
		return { type: 'instagram_tag', value, id: `tag_${shortHash(value)}` };
	}

	// TikTok user: "tiktok @username" or "tiktok username"
	const tiktokMatch = trimmed.match(/^tiktok\s+@?([\w.]+)$/i);
	if (tiktokMatch) {
		const tiktokUser = tiktokMatch[1];
		return { type: 'tiktok_user', value: tiktokUser, id: `tiktok_${shortHash(tiktokUser)}` };
	}

	// Instagram user (default, strip @ if present)
	const value = trimmed.replace(/^@/, '');
	if (!value) return null; // Prevent empty username
	return { type: 'instagram_user', value, id: `usr_${shortHash(value)}` };
}

/**
 * Get an emoji icon representing the source type.
 */
export function sourceTypeIcon(type: string): string {
	switch (type) {
		case 'instagram_user':
		case 'username': // legacy
			return '👤';
		case 'instagram_tag':
		case 'hashtag': // legacy
			return '#️⃣';
		case 'tiktok_user':
			return '🎵';
		case 'rss_url':
			return '🌐';
		default:
			return '📡';
	}
}

/**
 * Get a human-readable label for the source type.
 */
export function sourceTypeLabel(type: string): string {
	switch (type) {
		case 'instagram_user':
		case 'username':
			return 'IG User';
		case 'instagram_tag':
		case 'hashtag':
			return 'IG Tag';
		case 'tiktok_user':
			return 'TikTok';
		case 'rss_url':
			return 'RSS';
		default:
			return type;
	}
}
