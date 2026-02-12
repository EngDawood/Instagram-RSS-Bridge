import * as cheerio from 'cheerio';
import type { MediaNode, InstagramPost, InstagramUser, FetchResult } from '../types/instagram';
import { RSS_ITEMS_LIMIT } from '../constants';

// --- RSSHub Public Instances (failover list) ---
const RSSHUB_INSTANCES = [
	'https://rsshub.rssforever.com',
	'https://hub.slarker.me',
	'https://rsshub.pseudoyu.com',
	'https://rsshub.ktachibana.party',
	'https://rss.owo.nz',
	'https://rsshub.isrss.com',
];

const RSSHUB_TIMEOUT_MS = 8000;

/**
 * Try fetching RSS XML from public RSSHub instances.
 * Returns the raw RSS XML string on success, null if all instances fail.
 */
export async function fetchFromRSSHub(username: string): Promise<string | null> {
	for (const instance of RSSHUB_INSTANCES) {
		const url = `${instance}/picnob/profile/${username}`;
		try {
			console.log(`[RSSHub] Trying ${instance} for user: ${username}...`);
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), RSSHUB_TIMEOUT_MS);

			const response = await fetch(url, {
				signal: controller.signal,
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; RSSBridge/1.0)',
					Accept: 'application/rss+xml, application/xml, text/xml, */*',
				},
			});

			clearTimeout(timeout);

			if (!response.ok) {
				console.warn(`[RSSHub] ${instance} returned HTTP ${response.status}`);
				continue;
			}

			const xml = await response.text();

			// Basic validation: must look like RSS XML
			if (!xml.includes('<rss') && !xml.includes('<feed')) {
				console.warn(`[RSSHub] ${instance} returned non-RSS content`);
				continue;
			}

			console.log(`[RSSHub] Success with ${instance}`);
			return xml;
		} catch (err: any) {
			const msg = err.name === 'AbortError' ? 'Timeout' : err.message || 'Unknown error';
			console.warn(`[RSSHub] ${instance} failed: ${msg}`);
		}
	}

	console.warn('[RSSHub] All instances failed, falling back to mirror scraping');
	return null;
}

// --- Mirror Scraping Fallback ---

class InstagramClient {
	private mirrors = [
		{ name: 'Pixnoy', handler: this.fetchFromPixnoy.bind(this) },
		{ name: 'Imginn', handler: this.fetchFromImginn.bind(this) },
	];

	async getProfile(username: string): Promise<{ user: InstagramUser; posts: InstagramPost[] }> {
		const errors: string[] = [];

		for (const mirror of this.mirrors) {
			try {
				console.log(`[InstagramClient] Trying ${mirror.name} for user: ${username}...`);
				const result = await mirror.handler(username);
				console.log(`[InstagramClient] Success with ${mirror.name}! Found ${result.posts.length} posts.`);
				return result;
			} catch (err: any) {
				const msg = err.message || 'Unknown Error';
				console.warn(`[InstagramClient] ${mirror.name} failed: ${msg}`);
				errors.push(`${mirror.name}: ${msg}`);
			}
		}

		const errorString = errors.join(' | ');
		if (errorString.includes('404')) {
			throw new Error('User not found or Private Account (404). Mirrors cannot view private profiles.');
		}
		throw new Error(`All mirrors failed. Details: ${errorString}`);
	}

	// --- Pixnoy (formerly Pixwox) ---
	private async fetchFromPixnoy(username: string): Promise<{ user: InstagramUser; posts: InstagramPost[] }> {
		const url = `https://www.pixnoy.com/profile/${username}/`;
		const html = await this.fetchHtml(url);
		const $ = cheerio.load(html);

		if ($('.profile_title').length === 0) {
			if (html.includes('404')) throw new Error('404 Not Found (User might be private)');
			throw new Error('Invalid HTML structure');
		}

		const fullName = $('.profile_title').text().trim();
		const user: InstagramUser = {
			id: username,
			username: username,
			fullName: fullName,
			biography: $('.profile_desc').text().trim(),
			profilePicUrl: $('.profile_img img').attr('src') || '',
			isPrivate: false,
			externalUrl: '',
			followerCount: 0,
			followingCount: 0,
		};

		const posts: InstagramPost[] = [];
		$('.item').each((_, el) => {
			const $el = $(el);
			const link = $el.find('a').attr('href');
			const img = $el.find('img');
			const imageUrl = img.attr('src');

			if (imageUrl && link) {
				const fullLink = link.startsWith('http') ? link : `https://www.pixnoy.com${link}`;
				const id = link.split('/').filter(Boolean).pop() || crypto.randomUUID();

				posts.push({
					id,
					shortcode: id,
					type: 'image',
					displayUrl: imageUrl,
					caption: img.attr('alt') || 'No Caption',
					timestamp: new Date().toISOString(),
					dimensions: { height: 600, width: 600 },
					url: fullLink,
					ownerUsername: username,
				});
			}
		});

		return { user, posts: posts.slice(0, RSS_ITEMS_LIMIT) };
	}

	// --- Imginn ---
	private async fetchFromImginn(username: string): Promise<{ user: InstagramUser; posts: InstagramPost[] }> {
		const url = `https://imginn.com/${username}/`;
		const html = await this.fetchHtml(url);
		const $ = cheerio.load(html);

		if ($('.user-info').length === 0) {
			if (html.includes('Page Not Found')) throw new Error('404 Not Found');
			throw new Error('Invalid structure');
		}

		const user: InstagramUser = {
			id: username,
			username: $('.user-info h1').text().trim(),
			fullName: $('.user-info .name').text().trim(),
			biography: $('.user-info .desc').text().trim(),
			profilePicUrl: $('.user-info .img img').attr('src') || '',
			isPrivate: false,
			externalUrl: '',
			followerCount: 0,
			followingCount: 0,
		};

		const posts: InstagramPost[] = [];
		$('.items .item').each((_, el) => {
			const $el = $(el);
			const linkPath = $el.find('a').attr('href');
			if (!linkPath) return;

			const link = `https://imginn.com${linkPath}`;
			const img = $el.find('img');
			const imageUrl = img.attr('src') || img.attr('data-src');
			const caption = $el.find('.alt').text().trim();
			const id = linkPath
				.split('/')
				.filter((p) => p && p !== 'p')
				.pop() || crypto.randomUUID();

			if (imageUrl) {
				posts.push({
					id,
					shortcode: id,
					type: 'image',
					displayUrl: imageUrl,
					caption: caption,
					timestamp: new Date().toISOString(),
					dimensions: { height: 600, width: 600 },
					url: link,
					ownerUsername: username,
				});
			}
		});

		return { user, posts: posts.slice(0, RSS_ITEMS_LIMIT) };
	}

	private async fetchHtml(url: string): Promise<string> {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.5',
				'Cache-Control': 'no-cache',
				Pragma: 'no-cache',
				'Sec-Fetch-Dest': 'document',
				'Sec-Fetch-Mode': 'navigate',
				'Sec-Fetch-Site': 'none',
				'Sec-Fetch-User': '?1',
				'Upgrade-Insecure-Requests': '1',
			},
		});

		if (response.status === 404) {
			throw new Error('404 Not Found');
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		return await response.text();
	}
}

// --- Type Adapter: InstagramPost → MediaNode ---

function toMediaNode(post: InstagramPost): MediaNode {
	const typenameMap: Record<InstagramPost['type'], MediaNode['__typename']> = {
		image: 'GraphImage',
		video: 'GraphVideo',
		sidecar: 'GraphSidecar',
	};

	return {
		id: post.id,
		__typename: typenameMap[post.type],
		shortcode: post.shortcode,
		display_url: post.displayUrl,
		is_video: post.type === 'video',
		taken_at_timestamp: Math.floor(new Date(post.timestamp).getTime() / 1000),
		edge_media_to_caption: {
			edges: post.caption ? [{ node: { text: post.caption } }] : [],
		},
		owner: {
			id: post.ownerUsername,
			username: post.ownerUsername,
		},
		dimensions: post.dimensions,
	};
}

// --- Adapter for route compatibility ---

export const fetchInstagramData = async (context: any, _env?: any): Promise<FetchResult> => {
	const username = typeof context === 'string' ? context : context.value;
	const client = new InstagramClient();
	try {
		const { posts } = await client.getProfile(username);
		return {
			nodes: posts.map(toMediaNode),
			errors: [],
		};
	} catch (error: any) {
		return {
			nodes: [],
			errors: [
				{
					tier: 'CRITICAL',
					message: error.message || 'Unknown error',
					status: 500,
				},
			],
		};
	}
};
