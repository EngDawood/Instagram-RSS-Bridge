import type { Context } from 'hono';
import type { FeedContext, MediaTypeFilter } from '../types/instagram';
import { fetchFromRSSBridge } from '../services/instagram-client';
import { getCached, setCached } from '../utils/cache';
import { IG_BASE_URL, CACHE_PREFIX_FEED } from '../constants';

type HonoEnv = { Bindings: Env };

export async function handleInstagramFeed(c: Context<HonoEnv>): Promise<Response> {
	const username = c.req.query('u');
	const hashtag = c.req.query('h');
	const location = c.req.query('l');
	const mediaType = (c.req.query('media_type') || 'all') as MediaTypeFilter;
	const directLinks = c.req.query('direct_links') === 'true';

	const context = resolveContext(username, hashtag, location);
	if (!context) {
		return c.json(
			{
				error: 'Provide exactly one of: u (username), h (hashtag), l (location)',
				usage: '/instagram?u=username',
			},
			400
		);
	}

	// Check feed cache
	const cacheKey = `${CACHE_PREFIX_FEED}${context.type}:${context.value}:${mediaType}:${directLinks}`;
	const cachedXml = await getCached(c.env.CACHE, cacheKey);
	if (cachedXml) {
		return c.body(cachedXml, 200, {
			'Content-Type': 'application/rss+xml; charset=utf-8',
			'Cache-Control': 'public, max-age=900',
			'X-Cache': 'HIT',
		});
	}

	const ttl = parseInt(c.env.FEED_CACHE_TTL || '900', 10);

	// Try RSS-Bridge for username and hashtag feeds
	if (context.type === 'username' || context.type === 'hashtag') {
		const bridgeXml = await fetchFromRSSBridge(context);
		if (bridgeXml) {
			await setCached(c.env.CACHE, cacheKey, bridgeXml, ttl);
			return c.body(bridgeXml, 200, {
				'Content-Type': 'application/rss+xml; charset=utf-8',
				'Cache-Control': `public, max-age=${ttl}`,
				'X-Cache': 'MISS',
				'X-Source': 'rss-bridge',
			});
		}
	}

	// RSS-Bridge failed
	return c.json(
		{
			error: 'RSS-Bridge unavailable. No data found. Instagram may be blocking requests or the account does not exist.',
			context,
		},
		502
	);
}

function resolveContext(u?: string, h?: string, l?: string): FeedContext | null {
	const provided = [u, h, l].filter(Boolean);
	if (provided.length !== 1) return null;
	if (u) return { type: 'username', value: u };
	if (h) return { type: 'hashtag', value: h };
	if (l) return { type: 'location', value: l };
	return null;
}

function buildFeedTitle(ctx: FeedContext): string {
	switch (ctx.type) {
		case 'username':
			return `${ctx.value} - Instagram`;
		case 'hashtag':
			return `#${ctx.value} - Instagram`;
		case 'location':
			return `Location ${ctx.value} - Instagram`;
	}
}

function buildFeedLink(ctx: FeedContext): string {
	switch (ctx.type) {
		case 'username':
			return `${IG_BASE_URL}/${ctx.value}/`;
		case 'hashtag':
			return `${IG_BASE_URL}/explore/tags/${ctx.value}`;
		case 'location':
			return `${IG_BASE_URL}/explore/locations/${ctx.value}`;
	}
}
