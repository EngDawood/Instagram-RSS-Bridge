import * as cheerio from 'cheerio';
import type { FeedItem, FeedItemMedia, FeedItemMediaType, FetchResult } from '../types/feed';

const FETCH_TIMEOUT_MS = 10000;

/**
 * Fetch and parse any RSS/Atom feed URL into normalized FeedItem[].
 */
export async function fetchFeed(url: string, overrideFeedTitle?: string): Promise<FetchResult> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)',
				Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
			},
		});

		clearTimeout(timeout);

		if (!response.ok) {
			return {
				items: [],
				feedTitle: '',
				feedLink: '',
				errors: [{ tier: 'fetch', status: response.status, message: `HTTP ${response.status}` }],
			};
		}

		const xml = await response.text();

		// Detect RSS-Bridge error pages (cURL timeouts, PHP exceptions, etc.)
		if (xml.includes('HttpException') || xml.includes('cURL error')) {
			const snippet = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
			return {
				items: [],
				feedTitle: '',
				feedLink: '',
				errors: [{ tier: 'fetch', message: `RSS-Bridge error: ${snippet}` }],
			};
		}

		if (!xml.includes('<rss') && !xml.includes('<feed')) {
			return {
				items: [],
				feedTitle: '',
				feedLink: '',
				errors: [{ tier: 'parse', message: 'Response is not RSS or Atom XML' }],
			};
		}

		return parseXML(xml, overrideFeedTitle);
	} catch (err: any) {
		const message = err.name === 'AbortError' ? 'Timeout' : err.message || 'Unknown error';
		return {
			items: [],
			feedTitle: '',
			feedLink: '',
			errors: [{ tier: 'fetch', message }],
		};
	}
}

/**
 * Parse raw RSS/Atom XML into FeedItem[].
 */
export function parseXML(xml: string, overrideFeedTitle?: string): FetchResult {
	const $ = cheerio.load(xml, { xmlMode: true });
	const isAtom = $('feed').length > 0;

	const feedTitle = overrideFeedTitle || $('feed > title, channel > title').first().text().trim() || 'Untitled Feed';
	const feedLink = isAtom
		? ($('feed > link[rel="alternate"]').attr('href') || $('feed > link').attr('href') || '')
		: ($('channel > link').text().trim() || '');

	const items: FeedItem[] = [];
	const entries = isAtom ? $('entry') : $('item');

	entries.each((_, el) => {
		const entry = $(el);
		const item = isAtom ? parseAtomEntry(entry, $, feedTitle, feedLink) : parseRSSItem(entry, $, feedTitle, feedLink);
		if (item) items.push(item);
	});

	return { items, feedTitle, feedLink, errors: [] };
}

function parseAtomEntry(
	entry: cheerio.Cheerio<cheerio.Element>,
	$: cheerio.CheerioAPI,
	feedTitle: string,
	feedLink: string,
): FeedItem | null {
	const id = entry.find('id').text().trim();
	const link = entry.find('link[rel="alternate"]').attr('href')
		|| entry.find('link').attr('href')
		|| '';
	const title = entry.find('title').text().trim();
	const author = entry.find('author > name').text().trim();
	const published = entry.find('published').text() || entry.find('updated').text() || '';
	const timestamp = published ? Math.floor(new Date(published).getTime() / 1000) : 0;

	// Content extraction
	const contentHtml = entry.find('content').text() || entry.find('summary').text() || '';

	// Extract media
	const media = extractMedia(entry, $, contentHtml);

	// Extract text: try to get caption/body from content
	const text = extractTextFromHtml(contentHtml);

	const mediaType = deriveMediaType(media);

	return {
		id: id || link || '',
		link,
		title,
		text,
		author,
		feedTitle,
		feedLink,
		timestamp,
		mediaType,
		media,
	};
}

function parseRSSItem(
	entry: cheerio.Cheerio<cheerio.Element>,
	$: cheerio.CheerioAPI,
	feedTitle: string,
	feedLink: string,
): FeedItem | null {
	const guid = entry.find('guid').text().trim();
	const link = entry.find('link').text().trim();
	const title = entry.find('title').text().trim();
	const author = entry.find('author').text().trim()
		|| entry.find('dc\\:creator').text().trim()
		|| '';
	const pubDate = entry.find('pubDate').text() || '';
	const timestamp = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;

	const contentHtml = entry.find('content\\:encoded').text()
		|| entry.find('description').text()
		|| '';

	// Extract media from enclosures, media:content, and content HTML
	const media = extractMediaFromRSS(entry, $, contentHtml);

	const text = extractTextFromHtml(contentHtml);
	const mediaType = deriveMediaType(media);

	return {
		id: guid || link || '',
		link,
		title,
		text,
		author,
		feedTitle,
		feedLink,
		timestamp,
		mediaType,
		media,
	};
}

/**
 * Extract media from Atom entries: enclosures, content HTML (video/img).
 */
function extractMedia(
	entry: cheerio.Cheerio<cheerio.Element>,
	$: cheerio.CheerioAPI,
	contentHtml: string,
): FeedItemMedia[] {
	const media: FeedItemMedia[] = [];
	const seen = new Set<string>();

	// Atom enclosures: <link rel="enclosure">
	entry.find('link[rel="enclosure"]').each((_, el) => {
		const href = $(el).attr('href');
		const mimeType = $(el).attr('type') || '';
		if (href && !seen.has(href)) {
			seen.add(href);
			media.push({
				type: mimeType.startsWith('video/') ? 'video' : 'photo',
				url: href,
			});
		}
	});

	// Parse content HTML for <video><source> and <img>
	if (contentHtml) {
		const content$ = cheerio.load(contentHtml);

		// Video from <video><source src="...">
		content$('video source, source[type^="video"]').each((_, el) => {
			const src = content$(el).attr('src');
			if (src && !seen.has(src)) {
				seen.add(src);
				// Find poster/thumbnail
				const poster = content$(el).closest('video').attr('poster');
				media.push({ type: 'video', url: src, thumbnailUrl: poster });
			}
		});

		// Images from <img> (only if no enclosures found, to avoid duplicates)
		if (media.length === 0) {
			content$('img').each((_, el) => {
				const src = content$(el).attr('src');
				if (src && !seen.has(src)) {
					seen.add(src);
					media.push({ type: 'photo', url: src });
				}
			});
		}
	}

	return media;
}

/**
 * Extract media from RSS items: <enclosure>, <media:content>, content HTML.
 */
function extractMediaFromRSS(
	entry: cheerio.Cheerio<cheerio.Element>,
	$: cheerio.CheerioAPI,
	contentHtml: string,
): FeedItemMedia[] {
	const media: FeedItemMedia[] = [];
	const seen = new Set<string>();

	// RSS <enclosure>
	entry.find('enclosure').each((_, el) => {
		const url = $(el).attr('url');
		const mimeType = $(el).attr('type') || '';
		if (url && !seen.has(url)) {
			seen.add(url);
			media.push({
				type: mimeType.startsWith('video/') ? 'video' : 'photo',
				url,
			});
		}
	});

	// <media:content>
	entry.find('media\\:content').each((_, el) => {
		const url = $(el).attr('url');
		const medium = $(el).attr('medium') || '';
		const mimeType = $(el).attr('type') || '';
		if (url && !seen.has(url)) {
			seen.add(url);
			const thumbnail = entry.find('media\\:thumbnail').attr('url');
			media.push({
				type: medium === 'video' || mimeType.startsWith('video/') ? 'video' : 'photo',
				url,
				thumbnailUrl: thumbnail,
			});
		}
	});

	// Fallback: extract from content HTML
	if (media.length === 0 && contentHtml) {
		const content$ = cheerio.load(contentHtml);

		content$('video source, source[type^="video"]').each((_, el) => {
			const src = content$(el).attr('src');
			if (src && !seen.has(src)) {
				seen.add(src);
				media.push({ type: 'video', url: src });
			}
		});

		if (media.length === 0) {
			content$('img').each((_, el) => {
				const src = content$(el).attr('src');
				if (src && !seen.has(src)) {
					seen.add(src);
					media.push({ type: 'photo', url: src });
				}
			});
		}
	}

	return media;
}

/**
 * Strip HTML tags and extract plain text from content HTML.
 * For RSS-Bridge Instagram Atom, the caption is after the last <br><br>.
 */
function extractTextFromHtml(html: string): string {
	if (!html) return '';

	// Instagram RSS-Bridge pattern: caption is after the last <br><br>
	const brbrIdx = html.lastIndexOf('<br><br>');
	let textSource = html;
	if (brbrIdx !== -1) {
		const afterBrbr = html.substring(brbrIdx + 8);
		// Only use the after-brbr text if it has meaningful content
		const stripped = afterBrbr.replace(/<[^>]+>/g, '').trim();
		if (stripped.length > 0) {
			textSource = afterBrbr;
		}
	}

	return textSource
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.trim();
}

function deriveMediaType(media: FeedItemMedia[]): FeedItemMediaType {
	if (media.length === 0) return 'none';
	if (media.length > 1) return 'album';
	return media[0].type === 'video' ? 'video' : 'photo';
}
