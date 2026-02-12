import { Bot } from 'grammy';
import type { ChannelConfig, ChannelSource } from '../types/telegram';
import type { FeedContext, MediaNode, MediaTypeFilter } from '../types/instagram';
import { fetchInstagramData } from '../services/instagram-client';
import { getChannelConfig, saveChannelConfig, sendMediaToChannel } from '../services/telegram-bot';
import { formatMediaForTelegram } from '../utils/telegram-format';
import { getCached, setCached } from '../utils/cache';
import {
	CACHE_KEY_TELEGRAM_CHANNELS,
	CACHE_PREFIX_TELEGRAM_LASTSEEN,
	TELEGRAM_CONFIG_TTL,
} from '../constants';

/**
 * Cron handler: iterate all channels, check due sources, send new posts.
 */
export async function checkAllFeeds(env: Env): Promise<void> {
	const channelsRaw = await getCached(env.CACHE, CACHE_KEY_TELEGRAM_CHANNELS);
	if (!channelsRaw) return;

	const channels: string[] = JSON.parse(channelsRaw);
	if (channels.length === 0) return;

	const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
	const now = Date.now();

	for (const channelId of channels) {
		try {
			await checkChannel(channelId, now, bot, env);
		} catch (err) {
			console.error(`Error checking channel ${channelId}:`, err);
		}
	}
}

async function checkChannel(channelId: string, now: number, bot: Bot, env: Env): Promise<void> {
	const config = await getChannelConfig(env.CACHE, channelId);
	if (!config || !config.enabled) return;

	// Check if enough time has passed since last check
	const intervalMs = config.checkIntervalMinutes * 60 * 1000;
	if (now - config.lastCheckTimestamp < intervalMs) return;

	// Update last check timestamp
	config.lastCheckTimestamp = now;
	await saveChannelConfig(env.CACHE, channelId, config);

	// Check each enabled source
	for (const source of config.sources) {
		if (!source.enabled) continue;
		try {
			await checkSource(channelId, source, bot, env);
		} catch (err) {
			console.error(`Error checking source ${source.value} for channel ${channelId}:`, err);
		}
	}
}

async function checkSource(channelId: string, source: ChannelSource, bot: Bot, env: Env): Promise<void> {
	// Build feed context from source config
	const context: FeedContext = { type: source.type, value: source.value };

	// Fetch Instagram data using existing multi-tier service
	const result = await fetchInstagramData(context, env);
	if (result.nodes.length === 0) {
		if (result.errors.length > 0) {
			console.error(`[Cron] All tiers failed for ${source.value}:`, JSON.stringify(result.errors));
		}
		return;
	}
	let nodes = result.nodes;

	// Filter by media type
	nodes = filterByMediaType(nodes, source.mediaType);
	if (nodes.length === 0) return;

	// Get last seen shortcode
	const lastSeenKey = `${CACHE_PREFIX_TELEGRAM_LASTSEEN}${channelId}:${source.id}`;
	const lastSeenShortcode = await getCached(env.CACHE, lastSeenKey);

	// Find new posts (posts more recent than last seen)
	const newPosts: MediaNode[] = [];
	for (const node of nodes) {
		if (node.shortcode === lastSeenShortcode) break;
		newPosts.push(node);
	}

	if (newPosts.length === 0) return;

	// Send oldest first
	newPosts.reverse();

	// Limit to 5 posts per check to avoid flooding
	const postsToSend = newPosts.slice(0, 5);
	const chatId = parseInt(channelId, 10);

	for (const post of postsToSend) {
		try {
			const message = formatMediaForTelegram(post);
			await sendMediaToChannel(bot, chatId, message);
		} catch (err) {
			console.error(`Failed to send post ${post.shortcode} to ${channelId}:`, err);
		}
	}

	// Update last seen to the most recent post
	await setCached(env.CACHE, lastSeenKey, nodes[0].shortcode, TELEGRAM_CONFIG_TTL);
}

function filterByMediaType(nodes: MediaNode[], filter: MediaTypeFilter): MediaNode[] {
	if (filter === 'all') return nodes;
	return nodes.filter((node) => {
		switch (filter) {
			case 'video':
				return node.is_video;
			case 'picture':
				return node.__typename === 'GraphImage';
			case 'multiple':
				return node.__typename === 'GraphSidecar';
			default:
				return true;
		}
	});
}
