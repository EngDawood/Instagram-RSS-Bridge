export interface DetectedUrl {
	url: string;
	platform: 'YouTube' | 'Instagram' | 'TikTok' | 'Twitter' | 'Facebook' | 'Threads' | 'SoundCloud' | 'Spotify' | 'Pinterest';
}

const PLATFORM_PATTERNS: Array<{ platform: DetectedUrl['platform']; pattern: RegExp }> = [
	{ platform: 'YouTube', pattern: /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch|shorts\/)|youtu\.be\/|music\.youtube\.com\/watch)\S+/i },
	{ platform: 'Instagram', pattern: /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|stories)\/\S+/i },
	{ platform: 'TikTok', pattern: /https?:\/\/(?:(?:www|vm|vt)\.)?tiktok\.com\/\S+/i },
	{ platform: 'Twitter', pattern: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/\S+\/status\/\S+/i },
	{ platform: 'Facebook', pattern: /https?:\/\/(?:(?:www\.)?facebook\.com\/(?:share\/r\/|watch\/|\S+\/videos\/)|fb\.watch\/)\S+/i },
	{ platform: 'Threads', pattern: /https?:\/\/(?:www\.)?threads\.net\/@\S+\/post\/\S+/i },
	{ platform: 'SoundCloud', pattern: /https?:\/\/(?:www\.)?soundcloud\.com\/\S+\/\S+/i },
	{ platform: 'Spotify', pattern: /https?:\/\/(?:open\.)?spotify\.com\/track\/\S+/i },
	{ platform: 'Pinterest', pattern: /https?:\/\/(?:[a-z]{2}\.)?pinterest\.com\/pin\/\S+|https?:\/\/pin\.it\/\S+/i },
];

/**
 * Detect the first supported media platform URL in message text.
 */
export function detectMediaUrl(text: string): DetectedUrl | null {
	for (const { platform, pattern } of PLATFORM_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			return { url: match[0], platform };
		}
	}
	return null;
}
