import type { FeedItem, FetchResult } from '../types/feed';
import { fetchFeed } from './feed-fetcher';
import { RSS_ITEMS_LIMIT } from '../constants';

// --- RSS-Bridge Public Instances (failover list) ---
const RSS_BRIDGE_INSTANCES = [
	'https://rss-bridge.sans-nuage.fr',
	'https://rss.bloat.cat',
];

/**
 * Build the RSS-Bridge URL for an Instagram username.
 */
function buildRSSBridgeUserUrl(instance: string, username: string): string {
	return `${instance}/?action=display&bridge=InstagramBridge&format=Atom&direct_links=on&context=Username&u=${encodeURIComponent(username)}&media_type=all`;
}

/**
 * Build the RSS-Bridge URL for an Instagram hashtag.
 */
function buildRSSBridgeTagUrl(instance: string, hashtag: string): string {
	return `${instance}/?action=display&bridge=InstagramBridge&format=Atom&direct_links=on&context=Hashtag&h=${encodeURIComponent(hashtag)}&media_type=all`;
}

/**
 * Fetch Instagram user feed via RSS-Bridge instances, with failover.
 */
export async function fetchInstagramUser(username: string): Promise<FetchResult> {
	return fetchFromRSSBridgeInstances(
		(instance) => buildRSSBridgeUserUrl(instance, username),
		username,
	);
}

/**
 * Fetch Instagram hashtag feed via RSS-Bridge instances, with failover.
 */
export async function fetchInstagramTag(hashtag: string): Promise<FetchResult> {
	return fetchFromRSSBridgeInstances(
		(instance) => buildRSSBridgeTagUrl(instance, hashtag),
		`#${hashtag}`,
	);
}

/**
 * Try each RSS-Bridge instance in order, return first successful result.
 */
async function fetchFromRSSBridgeInstances(
	buildUrl: (instance: string) => string,
	label: string,
): Promise<FetchResult> {
	const allErrors: FetchResult['errors'] = [];

	for (const instance of RSS_BRIDGE_INSTANCES) {
		const url = buildUrl(instance);
		console.log(`[RSSBridge] Trying ${instance} for ${label}...`);

		const result = await fetchFeed(url);

		if (result.items.length > 0) {
			console.log(`[RSSBridge] Success with ${instance}`);
			return {
				...result,
				items: result.items.slice(0, RSS_ITEMS_LIMIT),
			};
		}

		allErrors.push(
			...result.errors.map((e) => ({ ...e, tier: `rss-bridge:${instance}` })),
		);
	}

	console.warn(`[RSSBridge] All instances failed for ${label}`);
	return {
		items: [],
		feedTitle: '',
		feedLink: '',
		errors: allErrors.length > 0
			? allErrors
			: [{ tier: 'rss-bridge', message: 'All instances returned empty results' }],
	};
}
