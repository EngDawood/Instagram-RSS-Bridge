import type { FeedContext } from '../types/instagram';

// --- RSS-Bridge Public Instances (failover list) ---
const RSS_BRIDGE_INSTANCES = [
	'https://rssbridge.prenghy.org',
	'https://rss-bridge.sans-nuage.fr',
	'https://rss.bloat.cat',
];

const RSS_BRIDGE_TIMEOUT_MS = 8000;

/**
 * Build the RSS-Bridge URL for a given feed context.
 */
function buildRSSBridgeUrl(instance: string, context: FeedContext): string {
	const base = `${instance}/?action=display&bridge=InstagramBridge&format=Atom&direct_links=on`;
	switch (context.type) {
		case 'username':
			return `${base}&context=Username&u=${encodeURIComponent(context.value)}&media_type=all`;
		case 'hashtag':
			return `${base}&context=Hashtag&h=${encodeURIComponent(context.value)}&media_type=all`;
		default:
			return `${base}&context=Username&u=${encodeURIComponent(context.value)}&media_type=all`;
	}
}

/**
 * Try fetching RSS/Atom XML from public RSS-Bridge instances.
 * Returns the raw XML string on success, null if all instances fail.
 */
export async function fetchFromRSSBridge(context: FeedContext): Promise<string | null> {
	for (const instance of RSS_BRIDGE_INSTANCES) {
		const url = buildRSSBridgeUrl(instance, context);
		try {
			console.log(`[RSSBridge] Trying ${instance} for ${context.type}: ${context.value}...`);
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), RSS_BRIDGE_TIMEOUT_MS);

			const response = await fetch(url, {
				signal: controller.signal,
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; RSSBridge/1.0)',
					Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
				},
			});

			clearTimeout(timeout);

			if (!response.ok) {
				console.warn(`[RSSBridge] ${instance} returned HTTP ${response.status}`);
				continue;
			}

			const xml = await response.text();

			// Basic validation: must look like RSS or Atom XML
			if (!xml.includes('<rss') && !xml.includes('<feed')) {
				console.warn(`[RSSBridge] ${instance} returned non-RSS content`);
				continue;
			}

			console.log(`[RSSBridge] Success with ${instance}`);
			return xml;
		} catch (err: any) {
			const msg = err.name === 'AbortError' ? 'Timeout' : err.message || 'Unknown error';
			console.warn(`[RSSBridge] ${instance} failed: ${msg}`);
		}
	}

	console.warn('[RSSBridge] All instances failed');
	return null;
}
