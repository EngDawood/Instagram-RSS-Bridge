import type { TopSearchResponse } from '../types/instagram';
import { IG_TOP_SEARCH, CACHE_PREFIX_UID } from '../constants';
import { buildHeaders } from '../utils/headers';
import { getCached, setCached } from '../utils/cache';

export async function resolveUserId(username: string, env: Env): Promise<string | null> {
	// Numeric input is already an ID
	if (/^\d+$/.test(username)) return username;

	// Check KV cache
	const cacheKey = `${CACHE_PREFIX_UID}${username.toLowerCase()}`;
	const cached = await getCached(env.CACHE, cacheKey);
	if (cached) return cached;

	// Query Instagram search
	const headers = buildHeaders(env);
	const url = `${IG_TOP_SEARCH}?query=${encodeURIComponent(username)}`;

	try {
		const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
		if (!res.ok) {
			console.error(`[UserResolver] HTTP ${res.status} for "${username}"`);
			return null;
		}

		const data: TopSearchResponse = await res.json();

		if (!data.users || data.users.length === 0) {
			console.error(`[UserResolver] No users in search results for "${username}"`);
			return null;
		}

		for (const result of data.users) {
			if (result.user.username.toLowerCase() === username.toLowerCase()) {
				const userId = result.user.pk;
				const ttl = parseInt(env.USER_ID_CACHE_TTL || '86400', 10);
				await setCached(env.CACHE, cacheKey, userId, ttl);
				return userId;
			}
		}

		console.error(`[UserResolver] "${username}" not found in ${data.users.length} search results`);
	} catch (err) {
		console.error(`[UserResolver] Exception for "${username}":`, err);
	}

	return null;
}
