// Instagram App ID — stable
export const IG_APP_ID = '936619743392459';

// GraphQL query hashes (from RSS-Bridge PHP — may need updating)
export const USER_QUERY_HASH = '58b6785bea111c67129decbe6a448951';
export const TAG_QUERY_HASH = '9b498c08113f1e09617a1703c22b2f32';
export const SHORTCODE_QUERY_HASH = '865589822932d1b43dfe312121dd353a';

// GraphQL doc_ids (newer POST approach — Instagram rotates these)
export const USER_POSTS_DOC_ID = '8845758582119845';

// API endpoints
export const IG_BASE_URL = 'https://www.instagram.com';
export const IG_API_BASE = 'https://i.instagram.com/api/v1';
export const IG_GRAPHQL_QUERY = `${IG_BASE_URL}/graphql/query/`;
export const IG_WEB_PROFILE = `${IG_API_BASE}/users/web_profile_info/`;
export const IG_TOP_SEARCH = `${IG_BASE_URL}/web/search/topsearch/`;

// Default User-Agent
export const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Cache key prefixes
export const CACHE_PREFIX_UID = 'uid:';
export const CACHE_PREFIX_FEED = 'feed:';

// Telegram cache key prefixes
export const CACHE_KEY_TELEGRAM_CHANNELS = 'telegram:channels';
export const CACHE_PREFIX_TELEGRAM_CHANNEL = 'telegram:channel:';
export const CACHE_PREFIX_TELEGRAM_LASTSEEN = 'telegram:lastseen:';
export const CACHE_PREFIX_TELEGRAM_STATE = 'telegram:state:';

// Telegram config KV TTL (1 year — effectively permanent)
export const TELEGRAM_CONFIG_TTL = 86400 * 365;

// Defaults
export const RSS_ITEMS_LIMIT = 12;
export const TITLE_MAX_LENGTH = 120;

// Format settings defaults
import type { FormatSettings } from './types/telegram';

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
	notification: 'normal',
	media: 'enable',
	author: 'disable',
	sourceFormat: 'disable',
	linkPreview: 'disable',
	lengthLimit: 0,
};

// Setting display names and ordered options for inline keyboard UI
export const FORMAT_LABELS: Record<
	keyof FormatSettings,
	{ label: string; options: { value: string; text: string }[] }
> = {
	notification: {
		label: 'Notification',
		options: [
			{ value: 'normal', text: 'Normal' },
			{ value: 'muted', text: 'Muted' },
		],
	},
	media: {
		label: 'Media',
		options: [
			{ value: 'enable', text: 'Enable' },
			{ value: 'disable', text: 'Disable' },
			{ value: 'only_media', text: 'Only media' },
		],
	},
	author: {
		label: 'Author',
		options: [
			{ value: 'enable', text: 'Enable' },
			{ value: 'disable', text: 'Disable' },
		],
	},
	sourceFormat: {
		label: 'Source',
		options: [
			{ value: 'title_link', text: 'Feed title and link' },
			{ value: 'link_only', text: 'Link only' },
			{ value: 'bare_url', text: 'Bare URL' },
			{ value: 'disable', text: 'Disable' },
		],
	},
	linkPreview: {
		label: 'Link preview',
		options: [
			{ value: 'enable', text: 'Enable' },
			{ value: 'disable', text: 'Disable' },
		],
	},
	lengthLimit: {
		label: 'Length limit',
		options: [
			{ value: '0', text: 'Unlimited' },
			{ value: '256', text: '256' },
			{ value: '512', text: '512' },
			{ value: '1024', text: '1024' },
		],
	},
};
