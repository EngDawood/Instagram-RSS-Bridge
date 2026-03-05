import type { FeedItem, FeedItemMedia, FeedItemMediaType } from '../types/feed';
import { downloadMedia } from '../services/media-downloader';

/**
 * Enrich feed items that have no media but link to a supported platform (e.g. TikTok).
 * Uses the media downloader to resolve actual video/image URLs.
 * Mutates items in-place. Non-fatal: failures leave items unchanged (sent as text).
 */
export async function enrichFeedItems(items: FeedItem[]): Promise<void> {
	for (const item of items) {
		// If it's TikTok or Douyin, we ALWAYS want to try enrichment because the RSS enclosure is usually just a cover photo.
		// For other platforms, we only enrich if media is missing.
		const isShortVideo = item.link.includes('tiktok.com') || item.link.includes('douyin.com');
		if (item.media.length > 0 && !isShortVideo) continue;

		try {
			const result = await downloadMedia(item.link, 'auto');
			if (result.status !== 'success' || !result.media?.length) continue;

			const enriched: FeedItemMedia[] = result.media
				.filter(m => m.type === 'photo' || m.type === 'video')
				.map(m => ({
					type: m.type as 'photo' | 'video',
					url: m.url,
					thumbnailUrl: result.thumbnail,
				}));

			if (enriched.length === 0) continue;

			// Replace RSS media with enriched media (direct video/images)
			item.media = enriched;
			item.mediaType = deriveMediaType(enriched);
		} catch (err) {
			console.warn(`[Enrich] TikTok enrichment failed for ${item.link}:`, (err as Error).message);
		}
	}
}

function deriveMediaType(media: FeedItemMedia[]): FeedItemMediaType {
	if (media.length === 0) return 'none';
	if (media.length > 1) return 'album';
	return media[0].type === 'video' ? 'video' : 'photo';
}
