export async function getCached(kv: KVNamespace, key: string): Promise<string | null> {
	return kv.get(key);
}

export async function setCached(kv: KVNamespace, key: string, value: string, ttlSeconds: number): Promise<void> {
	await kv.put(key, value, { expirationTtl: ttlSeconds });
}
