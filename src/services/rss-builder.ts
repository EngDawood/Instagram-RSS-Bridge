import type { RSSFeed, RSSItem } from '../types/rss';

export function buildRSSFeed(feed: RSSFeed): string {
	const itemsXml = feed.items.map(buildRSSItem).join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.link)}</link>
    <description>${escapeXml(feed.description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemsXml}
  </channel>
</rss>`;
}

function buildRSSItem(item: RSSItem): string {
	const enclosuresXml = item.enclosures
		.map((url) => `      <enclosure url="${escapeXml(url)}" type="${guessMediaType(url)}" length="0" />`)
		.join('\n');

	const thumbnailXml = item.thumbnail ? `      <media:thumbnail url="${escapeXml(item.thumbnail)}" />` : '';

	return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.uri)}</link>
      <guid isPermaLink="true">${escapeXml(item.uri)}</guid>
      <dc:creator>${escapeXml(item.author)}</dc:creator>
      <pubDate>${new Date(item.timestamp * 1000).toUTCString()}</pubDate>
      <description><![CDATA[${item.content.replace(/]]>/g, ']]]]><![CDATA[>')}]]></description>
      ${enclosuresXml}
${thumbnailXml}
    </item>`;
}

function escapeXml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function guessMediaType(url: string): string {
	if (url.includes('.mp4') || url.includes('video')) return 'video/mp4';
	return 'image/jpeg';
}
