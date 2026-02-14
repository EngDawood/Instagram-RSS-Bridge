import { getCached, setCached } from '../../../utils/cache';
import {
	CACHE_KEY_TELEGRAM_CHANNELS,
	CACHE_PREFIX_TELEGRAM_CHANNEL,
	TELEGRAM_CONFIG_TTL,
} from '../../../constants';
import type { ChannelConfig } from '../../../types/telegram';

/**
 * Get the list of all registered channel IDs.
 */
export async function getChannelsList(kv: KVNamespace): Promise<string[]> {
	const raw = await getCached(kv, CACHE_KEY_TELEGRAM_CHANNELS);
	if (!raw) return [];
	try {
		return JSON.parse(raw);
	} catch (err) {
		console.error('[KV] Corrupted channels list data:', err);
		return [];
	}
}

/**
 * Save the list of all registered channel IDs.
 */
export async function saveChannelsList(kv: KVNamespace, list: string[]): Promise<void> {
	await setCached(kv, CACHE_KEY_TELEGRAM_CHANNELS, JSON.stringify(list), TELEGRAM_CONFIG_TTL);
}

/**
 * Get configuration for a specific channel.
 */
export async function getChannelConfig(kv: KVNamespace, channelId: string): Promise<ChannelConfig | null> {
	const raw = await getCached(kv, `${CACHE_PREFIX_TELEGRAM_CHANNEL}${channelId}:config`);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch (err) {
		console.error(`[KV] Corrupted config for channel ${channelId}:`, err);
		return null;
	}
}

/**
 * Save configuration for a specific channel.
 */
export async function saveChannelConfig(kv: KVNamespace, channelId: string, config: ChannelConfig): Promise<void> {
	await setCached(kv, `${CACHE_PREFIX_TELEGRAM_CHANNEL}${channelId}:config`, JSON.stringify(config), TELEGRAM_CONFIG_TTL);
}

/**
 * Delete configuration for a specific channel.
 */
export async function deleteChannelConfig(kv: KVNamespace, channelId: string): Promise<void> {
	await kv.delete(`${CACHE_PREFIX_TELEGRAM_CHANNEL}${channelId}:config`);
}
