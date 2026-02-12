import type { MediaNode } from '../types/instagram';
import type { RSSItem } from '../types/rss';
import { IG_BASE_URL, TITLE_MAX_LENGTH } from '../constants';
import { processCaption, truncateTitle } from './text';

export function mediaNodeToRSSItem(node: MediaNode, directLinks: boolean): RSSItem {
	const postUri = `${IG_BASE_URL}/p/${node.shortcode}/`;
	const caption = node.edge_media_to_caption.edges[0]?.node.text || '';
	const author = node.owner.username;

	const videoPrefix = node.is_video ? '\u25B6 ' : '';
	const title = videoPrefix + truncateTitle(caption, TITLE_MAX_LENGTH) || `Post by ${author}`;

	const linkedCaption = processCaption(caption);

	let content: string;
	let enclosures: string[];
	let thumbnail: string | undefined;

	switch (node.__typename) {
		case 'GraphSidecar':
			({ content, enclosures } = buildSidecarContent(node, postUri, linkedCaption, directLinks));
			break;
		case 'GraphVideo':
			({ content, enclosures, thumbnail } = buildVideoContent(node, postUri, linkedCaption, directLinks));
			break;
		case 'GraphImage':
		default:
			({ content, enclosures } = buildImageContent(node, postUri, linkedCaption, directLinks));
			break;
	}

	return { uri: postUri, author, title, content, enclosures, thumbnail, timestamp: node.taken_at_timestamp };
}

function buildImageContent(node: MediaNode, postUri: string, caption: string, directLinks: boolean) {
	const mediaUrl = directLinks ? node.display_url : `${postUri}media?size=l`;
	const content = `<a href="${postUri}" target="_blank"><img src="${mediaUrl}" alt="" /></a><br><br>${caption}`;
	return { content, enclosures: [mediaUrl] };
}

function buildVideoContent(node: MediaNode, postUri: string, caption: string, directLinks: boolean) {
	const posterUrl = node.display_url;
	const videoUrl = node.video_url || posterUrl;
	const content = `<video controls poster="${posterUrl}"><source src="${videoUrl}" type="video/mp4"></video><br><br>${caption}`;
	const enclosures = directLinks && node.video_url ? [node.video_url] : [posterUrl];
	return { content, enclosures, thumbnail: posterUrl };
}

function buildSidecarContent(node: MediaNode, postUri: string, caption: string, directLinks: boolean) {
	const enclosures: string[] = [];
	let mediaHtml = '';

	for (const edge of node.edge_sidecar_to_children?.edges || []) {
		const child = edge.node;
		const mediaUrl = directLinks ? child.display_url : `${postUri}media?size=l`;

		if (child.is_video && child.video_url) {
			mediaHtml += `<video controls poster="${child.display_url}"><source src="${child.video_url}" type="video/mp4"></video><br>`;
			enclosures.push(directLinks ? child.video_url : child.display_url);
		} else {
			mediaHtml += `<a href="${postUri}" target="_blank"><img src="${mediaUrl}" alt="" /></a><br>`;
			enclosures.push(mediaUrl);
		}
	}

	const content = `${mediaHtml}<br>${caption}`;
	return { content, enclosures };
}
