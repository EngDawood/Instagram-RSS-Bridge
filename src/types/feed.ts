export type FeedItemMediaType = 'photo' | 'video' | 'album' | 'none';
export type FeedMediaFilter = 'all' | 'photo' | 'video' | 'album';

export interface FeedItemMedia {
	type: 'photo' | 'video';
	url: string;
	thumbnailUrl?: string;
}

export interface FeedItem {
	/** Stable unique key — GUID from RSS, or link URL, or hash. Used for dedup. */
	id: string;
	/** Canonical link to the post/article */
	link: string;
	title: string;
	/** Plain text caption/body (HTML stripped) */
	text: string;
	/** Author name (feed-level or per-entry) */
	author: string;
	/** Feed channel title (e.g. "natgeo — Instagram", "BBC News") */
	feedTitle: string;
	/** Feed homepage URL */
	feedLink: string;
	timestamp: number;
	mediaType: FeedItemMediaType;
	/** Empty = text only, [1] = single, [n] = album */
	media: FeedItemMedia[];
}

export interface FetchResult {
	items: FeedItem[];
	feedTitle: string;
	feedLink: string;
	errors: Array<{ tier: string; status?: number; message: string }>;
}
