const BTCH_SERVERS = [
	'https://backend1.tioo.eu.org',
	'https://backend2.tioo.eu.org',
	'https://backend3.tioo.eu.org',
	'https://backend4.tioo.eu.org',
];
const BTCH_HEADERS = {
	'User-Agent': 'btch/6.0.25',
	'X-Client-Version': '6.0.25',
	'Content-Type': 'application/json',
};

export interface MediaItem {
	type: 'video' | 'photo' | 'audio';
	url: string;
	quality?: string;
	filesize?: number;
}

export interface DownloaderResult {
	status: 'success' | 'error' | 'picker';
	media?: MediaItem[];
	caption?: string;
	thumbnail?: string;
	error?: string;
}

/**
 * Fetch from btch API with server failover.
 * Tries each backend in order; moves to next on 5xx or network error.
 */
async function btchFetch(endpoint: string, url: string): Promise<any> {
	let lastError: Error | null = null;
	for (const server of BTCH_SERVERS) {
		try {
			const res = await fetch(`${server}/api/downloader/${endpoint}?url=${encodeURIComponent(url)}`, {
				headers: BTCH_HEADERS,
				signal: AbortSignal.timeout(30_000),
			});
			if (res.status >= 500) {
				lastError = new Error(`btch ${endpoint} returned ${res.status}`);
				continue; // try next server
			}
			if (!res.ok) throw new Error(`btch ${endpoint} returned ${res.status}`);
			const data: any = await res.json();
			if (typeof data === 'string') throw new Error(`btch ${endpoint}: ${data}`);
			if (data.error) throw new Error(`btch ${endpoint}: ${data.error}`);
			return data;
		} catch (err: any) {
			lastError = err;
			// Only retry on network/timeout/5xx errors, not on 4xx or parse errors
			if (err.name === 'TimeoutError' || err.message?.includes('returned 5')) continue;
			throw err;
		}
	}
	throw lastError || new Error(`btch ${endpoint}: all servers failed`);
}

/** Check if a value is a valid non-empty URL string */
function isUrl(val: unknown): val is string {
	return typeof val === 'string' && val.startsWith('http');
}

/**
 * Detect photo vs video from a rapidcdn.app JWT URL by decoding the payload.
 */
function detectTypeFromJwtUrl(url: string): 'photo' | 'video' {
	try {
		const token = new URL(url).searchParams.get('token');
		if (token) {
			const payloadB64 = token.split('.')[1];
			const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
			const hint = payload.filename || payload.url || '';
			if (/\.(jpg|jpeg|png|webp|heic|gif)/i.test(hint)) return 'photo';
		}
	} catch { /* ignore decode errors */ }
	return 'video';
}

function detectMediaType(url: string): 'photo' | 'video' {
	if (url.includes('rapidcdn.app')) return detectTypeFromJwtUrl(url);
	if (/\.(jpg|jpeg|png|webp|heic|gif)/i.test(url)) return 'photo';
	return 'video';
}

/**
 * Extract the direct CDN URL from a tiktokio.com download token.
 */
function decodeTiktokDirectUrl(proxyUrl: string): string | null {
	try {
		const u = new URL(proxyUrl);
		const token = u.searchParams.get('token');
		if (!token) return null;
		const b64 = 'aHR0c' + token.slice(10).replace(/O0O0O$/, '');
		const decoded = atob(b64);
		const match = decoded.match(/^(https?:\/\/.+?\.\w{2,4})/);
		return match ? match[1] : null;
	} catch { return null; }
}

/** Build a caption string from title and author. */
function buildCaption(title?: string, author?: string): string {
	if (!title) return '';
	return author ? `<b>${title}</b> — ${author}` : `<b>${title}</b>`;
}

/**
 * Try AIO endpoint first — returns richer data (caption, author, gallery, quality options).
 * Returns null if AIO fails or has no media, so caller can fall back to platform-specific endpoint.
 */
async function tryAIO(url: string, mode: string = 'auto'): Promise<DownloaderResult | null> {
	try {
		const res = await btchFetch('aio', url);
		const data = res.data;
		if (!data) return null;

		const caption = buildCaption(data.title, data.author?.full_name || data.author?.username);
		const thumbnail = data.thumbnail;
		const media: MediaItem[] = [];

		// Handle carousel/gallery posts (Instagram, etc.)
		if (data.gallery?.items?.length > 0) {
			for (const item of data.gallery.items) {
				let mediaUrl: string | null = null;
				if (Array.isArray(item.resources) && item.resources.length > 0) {
					mediaUrl = item.resources[0]?.src || null;
				}
				if (!mediaUrl && isUrl(item.urls?.url)) {
					mediaUrl = item.urls.url;
				}
				if (mediaUrl && isUrl(mediaUrl)) {
					media.push({ type: detectMediaType(mediaUrl), url: mediaUrl });
				}
			}
		}

		// Handle video/audio links (if no gallery items found)
		if (media.length === 0 && data.links) {
			if (mode === 'audio') {
				const audioLinks = data.links.audio;
				if (audioLinks) {
					const entries = Array.isArray(audioLinks) ? audioLinks : Object.values(audioLinks);
					for (const a of entries as any[]) {
						if (isUrl(a?.url)) {
							media.push({ type: 'audio', url: a.url, quality: a.q_text });
						}
					}
				}
			}
			if (media.length === 0) {
				const videoLinks = data.links.video;
				if (videoLinks) {
					const entries = Array.isArray(videoLinks) ? videoLinks : Object.values(videoLinks);
					for (const v of entries as any[]) {
						if (isUrl(v?.url)) {
							media.push({ type: 'video', url: v.url, quality: v.q_text || v.resolution });
						}
					}
				}
			}
		}

		if (media.length > 0) {
			return { status: 'success', media, caption, thumbnail };
		}
	} catch (e) {
		console.warn('[downloader] AIO failed:', (e as Error).message);
	}
	return null;
}

/**
 * Download media from a URL using platform-specific btch API endpoints.
 * @param mode 'auto' returns video/photo, 'audio' returns audio, 'hd'/'sd' for quality
 */
export async function downloadMedia(url: string, mode: 'auto' | 'audio' | 'hd' | 'sd' = 'auto'): Promise<DownloaderResult> {
	try {
		const lowerUrl = url.toLowerCase();

		// 1. TikTok — use rich 'tiktok' endpoint, fallback to 'ttdl'
		if (lowerUrl.includes('tiktok.com')) {
			return await downloadTikTok(url, mode);
		}

		// 2. Instagram
		if (lowerUrl.includes('instagram.com')) {
			return await downloadInstagram(url);
		}

		// 3. Twitter / X
		if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) {
			return await downloadTwitter(url);
		}

		// 4. YouTube — use AIO for quality options
		if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be') || lowerUrl.includes('music.youtube.com')) {
			return await downloadYouTube(url, mode);
		}

		// 5. Facebook
		if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch')) {
			return await downloadFacebook(url);
		}

		// 6. Threads
		if (lowerUrl.includes('threads.net')) {
			return await downloadThreads(url, mode);
		}

		// 7. SoundCloud
		if (lowerUrl.includes('soundcloud.com')) {
			return await downloadSoundCloud(url);
		}

		// 8. Spotify
		if (lowerUrl.includes('spotify.com')) {
			return await downloadSpotify(url);
		}

		// 9. Pinterest
		if (lowerUrl.includes('pinterest.com') || lowerUrl.includes('pin.it')) {
			return await downloadPinterest(url);
		}

		// Catch-all fallback using AIO
		return await downloadAIO(url, mode);
	} catch (err: any) {
		console.error('[downloader] Error:', err);
		return { status: 'error', error: err.message || 'Unknown error' };
	}
}

// ─── Platform handlers ───────────────────────────────────────────

async function downloadTikTok(url: string, mode: string): Promise<DownloaderResult> {
	// Try richer 'tiktok' endpoint first for quality options
	try {
		const res = await btchFetch('tiktok', url);
		const data = res.data;
		if (data) {
			const caption = buildCaption(data.title, data.author?.nickname);
			const thumbnail = data.cover || data.origin_cover;

			if (mode === 'audio' && isUrl(data.music)) {
				return { status: 'success', media: [{ type: 'audio', url: data.music }], caption, thumbnail };
			}
			if (mode === 'hd' && isUrl(data.hdplay)) {
				return { status: 'success', media: [{ type: 'video', url: data.hdplay, quality: 'HD', filesize: data.hd_size }], caption, thumbnail };
			}
			if (mode === 'sd' && isUrl(data.play)) {
				return { status: 'success', media: [{ type: 'video', url: data.play, quality: 'SD', filesize: data.size }], caption, thumbnail };
			}
			// Default: prefer HD, fallback to SD
			const videoUrl = isUrl(data.hdplay) ? data.hdplay : isUrl(data.play) ? data.play : null;
			if (videoUrl) {
				return { status: 'success', media: [{ type: 'video', url: videoUrl, quality: isUrl(data.hdplay) ? 'HD' : 'SD' }], caption, thumbnail };
			}
		}
	} catch (e) {
		console.warn('[downloader] tiktok endpoint failed, trying ttdl:', (e as Error).message);
	}

	// Fallback to 'ttdl' (alternative endpoint)
	const res = await btchFetch('ttdl', url);
	const caption = res.title || '';
	if (mode === 'audio' && Array.isArray(res.audio) && isUrl(res.audio[0])) {
		const directAudio = decodeTiktokDirectUrl(res.audio[0]) || res.audio[0];
		return { status: 'success', media: [{ type: 'audio', url: directAudio }], caption };
	}
	if (Array.isArray(res.video) && isUrl(res.video[0])) {
		const directVideo = decodeTiktokDirectUrl(res.video[0]) || res.video[0];
		return { status: 'success', media: [{ type: 'video', url: directVideo }], caption };
	}
	return { status: 'error', error: 'No TikTok media found' };
}

async function downloadInstagram(url: string): Promise<DownloaderResult> {
	// Try AIO first — returns caption, author, gallery (carousel), and media links
	try {
		const res = await btchFetch('aio', url);
		const data = res.data;
		if (data) {
			const caption = data.title || '';
			const author = data.author?.username;
			const thumbnail = data.thumbnail;
			const media: MediaItem[] = [];

			// Handle carousel/gallery posts
			if (data.gallery?.items?.length > 0) {
				for (const item of data.gallery.items) {
					let mediaUrl: string | null = null;
					if (Array.isArray(item.resources) && item.resources.length > 0) {
						mediaUrl = item.resources[0]?.src || null;
					}
					if (!mediaUrl && isUrl(item.urls?.url)) {
						mediaUrl = item.urls.url;
					}
					if (mediaUrl && isUrl(mediaUrl)) {
						media.push({ type: detectMediaType(mediaUrl), url: mediaUrl });
					}
				}
			}

			// Handle single video/audio via links
			if (media.length === 0 && data.links) {
				const videoLinks = data.links.video;
				if (videoLinks) {
					const entries = Array.isArray(videoLinks) ? videoLinks : Object.values(videoLinks);
					for (const v of entries as any[]) {
						if (isUrl(v?.url)) {
							media.push({ type: 'video', url: v.url, quality: v.q_text || v.resolution });
						}
					}
				}
			}

			if (media.length > 0) {
				return {
					status: 'success',
					media,
					caption: author ? `${caption}\n\n@${author}` : caption,
					thumbnail,
				};
			}
		}
	} catch (e) {
		console.warn('[downloader] AIO for Instagram failed, trying igdl:', (e as Error).message);
	}

	// Fallback to igdl — no caption available
	const res = await btchFetch('igdl', url);
	const items = Array.isArray(res) ? res : Array.isArray(res.result) ? res.result : null;
	if (items && items.length > 0 && isUrl(items[0]?.url)) {
		return {
			status: 'success',
			media: items.filter((item: any) => isUrl(item.url)).map((item: any) => ({
				type: detectMediaType(item.url),
				url: item.url,
			})),
			caption: '',
			thumbnail: items[0]?.thumbnail,
		};
	}
	return { status: 'error', error: 'No Instagram media found' };
}

async function downloadTwitter(url: string): Promise<DownloaderResult> {
	// Try AIO first — better for image tweets and captions
	const aioResult = await tryAIO(url);
	if (aioResult) return aioResult;

	// Fallback to twitter endpoint
	const res = await btchFetch('twitter', url);
	// Note: res.creator is the API developer name, not the tweet author
	const caption = res.title || '';
	if (Array.isArray(res.url) && res.url.length > 0) {
		const media: MediaItem[] = [];
		for (const item of res.url) {
			if (typeof item === 'object' && item !== null) {
				const mediaUrl = isUrl(item.hd) ? item.hd : isUrl(item.sd) ? item.sd : null;
				if (mediaUrl) {
					media.push({ type: detectMediaType(mediaUrl), url: mediaUrl });
				}
			} else if (typeof item === 'string' && isUrl(item)) {
				media.push({ type: detectMediaType(item), url: item });
			}
		}
		if (media.length > 0) {
			return { status: 'success', media, caption };
		}
	}
	if (isUrl(res.url)) {
		const type = detectMediaType(res.url);
		return { status: 'success', media: [{ type, url: res.url }], caption };
	}
	return { status: 'error', error: 'No Twitter media found' };
}

async function downloadYouTube(url: string, mode: string): Promise<DownloaderResult> {
	// Try AIO endpoint for quality options
	try {
		const aio = await btchFetch('aio', url);
		const data = aio.data;
		if (data?.links) {
			const caption = buildCaption(data.title, data.author?.full_name || data.author?.username);
			const thumbnail = data.thumbnail;

			if (mode === 'audio' && data.links.audio?.length > 0) {
				const best = data.links.audio[0];
				if (isUrl(best.url)) {
					return { status: 'success', media: [{ type: 'audio', url: best.url, quality: best.q_text }], caption, thumbnail };
				}
			}
			if (data.links.video?.length > 0) {
				const videos: MediaItem[] = data.links.video
					.filter((v: any) => isUrl(v.url))
					.map((v: any) => ({ type: 'video' as const, url: v.url, quality: v.q_text }));
				if (videos.length > 0) {
					// If mode specifies a quality, find it; otherwise return best (first)
					if (mode !== 'auto' && mode !== 'audio') {
						const match = videos.find(v => v.quality?.includes(mode));
						if (match) return { status: 'success', media: [match], caption, thumbnail };
					}
					return { status: 'success', media: [videos[0]], caption, thumbnail };
				}
			}
		}
	} catch (e) {
		console.warn('[downloader] AIO for YouTube failed, trying youtube endpoint:', (e as Error).message);
	}

	// Fallback to youtube endpoint (single quality)
	const res = await btchFetch('youtube', url);
	const caption = buildCaption(res.title, res.author);
	const thumbnail = res.thumbnail;
	if (mode === 'audio' && isUrl(res.mp3)) {
		return { status: 'success', media: [{ type: 'audio', url: res.mp3 }], caption, thumbnail };
	}
	if (isUrl(res.mp4)) {
		return { status: 'success', media: [{ type: 'video', url: res.mp4 }], caption, thumbnail };
	}
	return { status: 'error', error: 'No YouTube media found' };
}

/**
 * Fetch YouTube video quality options without downloading.
 * Returns available qualities for the user to choose from.
 */
export async function fetchYouTubeQualities(url: string): Promise<{ caption: string; thumbnail?: string; qualities: Array<{ quality: string; url: string; size?: string }> } | null> {
	try {
		const aio = await btchFetch('aio', url);
		const data = aio.data;
		if (data?.links?.video?.length > 0) {
			const caption = buildCaption(data.title, data.author?.full_name || data.author?.username);
			const qualities = data.links.video
				.filter((v: any) => isUrl(v.url))
				.map((v: any) => ({ quality: v.q_text || 'unknown', url: v.url, size: v.size }));
			if (qualities.length > 0) {
				return { caption, thumbnail: data.thumbnail, qualities };
			}
		}
	} catch (e) {
		console.warn('[downloader] fetchYouTubeQualities failed:', (e as Error).message);
	}
	return null;
}

/** Format bytes to human-readable string */
export function formatFileSize(bytes: number | undefined | null): string {
	if (!bytes || bytes <= 0) return '';
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Fetch TikTok video info (sizes) without downloading.
 * Returns HD/SD sizes for the picker buttons.
 */
export async function fetchTikTokInfo(url: string): Promise<{ caption: string; hdSize?: string; sdSize?: string; audioAvailable: boolean } | null> {
	try {
		const res = await btchFetch('tiktok', url);
		const data = res.data;
		if (data) {
			const caption = buildCaption(data.title, data.author?.nickname);
			return {
				caption,
				hdSize: formatFileSize(data.hd_size),
				sdSize: formatFileSize(data.size),
				audioAvailable: isUrl(data.music),
			};
		}
	} catch (e) {
		console.warn('[downloader] fetchTikTokInfo failed:', (e as Error).message);
	}
	return null;
}

async function downloadFacebook(url: string): Promise<DownloaderResult> {
	// Try AIO first — returns caption and author
	const aioResult = await tryAIO(url);
	if (aioResult) return aioResult;

	// Fallback to fbdown endpoint
	const res = await btchFetch('fbdown', url);
	const videoUrl = isUrl(res.HD) ? res.HD : isUrl(res.Normal_video) ? res.Normal_video : null;
	if (videoUrl) {
		return { status: 'success', media: [{ type: 'video', url: videoUrl }] };
	}
	return { status: 'error', error: 'No Facebook media found' };
}

async function downloadThreads(url: string, mode: string): Promise<DownloaderResult> {
	// Try AIO first — returns caption and author
	const aioResult = await tryAIO(url, mode);
	if (aioResult) return aioResult;

	// Fallback to threads endpoint
	const res = await btchFetch('threads', url);
	// API returns flat: { status, type: 'video'|'image'|'mixed', video?, image?, download? }
	const hasVideo = res.type === 'video' && isUrl(res.video);
	const hasImage = (res.type === 'image' || res.type === 'mixed') && isUrl(res.image);

	if (mode === 'audio' && hasVideo) {
		return { status: 'success', media: [{ type: 'audio', url: res.video }] };
	}

	if (res.type === 'mixed') {
		const media: MediaItem[] = [];
		if (isUrl(res.video)) media.push({ type: 'video', url: res.video });
		if (isUrl(res.image)) media.push({ type: 'photo', url: res.image });
		if (media.length > 0) return { status: 'success', media };
	}

	if (hasVideo) {
		return { status: 'success', media: [{ type: 'video', url: res.video }] };
	}
	if (hasImage) {
		return { status: 'success', media: [{ type: 'photo', url: res.image }] };
	}
	if (isUrl(res.download)) {
		return { status: 'success', media: [{ type: 'video', url: res.download }] };
	}
	return { status: 'error', error: 'No Threads media found' };
}

async function downloadSoundCloud(url: string): Promise<DownloaderResult> {
	const res = await btchFetch('soundcloud', url);
	// API returns flat: { status, title, thumbnail, audio, downloadMp3, downloadArtwork }
	const audioUrl = isUrl(res.downloadMp3) ? res.downloadMp3 : isUrl(res.audio) ? res.audio : null;
	if (audioUrl) {
		return { status: 'success', media: [{ type: 'audio', url: audioUrl }], caption: res.title || '', thumbnail: res.thumbnail };
	}
	return { status: 'error', error: 'No SoundCloud audio found' };
}

async function downloadSpotify(url: string): Promise<DownloaderResult> {
	const res = await btchFetch('spotify', url);
	// API returns: { status, res_data: { title, thumbnail, duration, formats: [{url, quality, filesize, ...}] } }
	const data = res.res_data;
	if (data?.formats?.length > 0) {
		const best = data.formats[0];
		if (isUrl(best.url)) {
			return {
				status: 'success',
				media: [{ type: 'audio', url: best.url, quality: best.quality }],
				caption: data.title || '',
				thumbnail: data.thumbnail,
			};
		}
	}
	return { status: 'error', error: 'No Spotify audio found' };
}

async function downloadPinterest(url: string): Promise<DownloaderResult> {
	// Try AIO first — returns caption and author
	const aioResult = await tryAIO(url);
	if (aioResult) return aioResult;

	// Fallback to pinterest endpoint
	const res = await btchFetch('pinterest', url);
	if (res.result) {
		const item = Array.isArray(res.result) ? res.result[0] : res.result;
		const isVideo = item?.is_video && isUrl(item?.video_url);
		const imageUrl = item?.images?.orig?.url || item?.image;
		const mediaUrl = isVideo ? item.video_url : isUrl(imageUrl) ? imageUrl : null;
		if (mediaUrl) {
			const caption = item.title || item.description || '';
			const author = item.user?.full_name;
			return {
				status: 'success',
				media: [{ type: isVideo ? 'video' : 'photo', url: mediaUrl }],
				caption: buildCaption(caption, author),
				thumbnail: item?.images?.['236x']?.url,
			};
		}
	}
	return { status: 'error', error: 'No Pinterest media found' };
}

async function downloadAIO(url: string, mode: string): Promise<DownloaderResult> {
	// Use shared tryAIO helper which handles gallery, video, and audio
	const result = await tryAIO(url, mode);
	if (result) return result;

	// Legacy flat fields fallback
	try {
		const res = await btchFetch('aio', url);
		const fallbackCaption = res.data?.title || res.title || '';
		if (mode === 'audio' && isUrl(res.mp3)) {
			return { status: 'success', media: [{ type: 'audio', url: res.mp3 }], caption: fallbackCaption };
		}
		if (isUrl(res.mp4)) {
			return { status: 'success', media: [{ type: 'video', url: res.mp4 }], caption: fallbackCaption };
		}
	} catch { /* already tried in tryAIO */ }

	return { status: 'error', error: 'Unsupported platform or no media found' };
}
