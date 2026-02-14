import { getCached, setCached } from '../../../utils/cache';
import { CACHE_PREFIX_TELEGRAM_STATE } from '../../../constants';
import type { AdminState } from '../../../types/telegram';

/**
 * Get the current multi-step flow state for an admin user.
 */
export async function getAdminState(kv: KVNamespace, userId: number): Promise<AdminState | null> {
	const raw = await getCached(kv, `${CACHE_PREFIX_TELEGRAM_STATE}${userId}`);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch (err) {
		console.error(`[KV] Corrupted admin state for user ${userId}:`, err);
		return null;
	}
}

/**
 * Set the multi-step flow state for an admin user (expires in 1 hour).
 */
export async function setAdminState(kv: KVNamespace, userId: number, state: AdminState): Promise<void> {
	await setCached(kv, `${CACHE_PREFIX_TELEGRAM_STATE}${userId}`, JSON.stringify(state), 3600);
}

/**
 * Clear the multi-step flow state for an admin user.
 */
export async function clearAdminState(kv: KVNamespace, userId: number): Promise<void> {
	await kv.delete(`${CACHE_PREFIX_TELEGRAM_STATE}${userId}`);
}
