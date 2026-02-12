import type { FeedContext, MediaNode, MediaConnection, WebProfileInfoResponse, GraphQLResponse, TierError, FetchResult } from '../types/instagram';
import {
	IG_WEB_PROFILE,
	IG_GRAPHQL_QUERY,
	IG_BASE_URL,
	USER_QUERY_HASH,
	TAG_QUERY_HASH,
	USER_POSTS_DOC_ID,
	RSS_ITEMS_LIMIT,
} from '../constants';
import { buildHeaders } from '../utils/headers';
import { resolveUserId } from './user-resolver';

type TierResult = { nodes: MediaNode[] | null; error?: TierError };

const FETCH_TIMEOUT = 8000; // 8 seconds per tier

/** Check if response is HTML (login redirect) instead of expected JSON */
function isHtmlResponse(res: Response): boolean {
	const ct = res.headers.get('content-type') || '';
	return ct.includes('text/html');
}

/**
 * Fetches Instagram media data using a multi-tier fallback strategy:
 * 1. REST API (web_profile_info) — username only
 * 2. GraphQL GET (query_hash) — username/hashtag/location
 * 3. GraphQL POST (doc_id) — username only
 * 4. Embed page scraping — username only
 */
export async function fetchInstagramData(context: FeedContext, env: Env): Promise<FetchResult> {
	const headers = buildHeaders(env);
	const errors: TierError[] = [];
	const envRecord = env as unknown as Record<string, string | undefined>;

	// Tier 1: REST API (username only)
	if (context.type === 'username') {
		try {
			const result = await fetchViaRestApi(context.value, headers);
			if (result.nodes && result.nodes.length > 0) return { nodes: result.nodes, errors };
			if (result.error) errors.push(result.error);
		} catch (err) {
			errors.push({ tier: 'REST API', message: String(err) });
		}
	}

	// Tier 2: GraphQL GET (query_hash approach)
	try {
		const result = await fetchViaGraphQLGet(context, headers, env, envRecord);
		if (result.nodes && result.nodes.length > 0) return { nodes: result.nodes, errors };
		if (result.error) errors.push(result.error);
	} catch (err) {
		errors.push({ tier: 'GraphQL GET', message: String(err) });
	}

	// Tier 3: GraphQL POST (doc_id approach, username only)
	if (context.type === 'username') {
		try {
			const result = await fetchViaGraphQLPost(context.value, headers, env, envRecord);
			if (result.nodes && result.nodes.length > 0) return { nodes: result.nodes, errors };
			if (result.error) errors.push(result.error);
		} catch (err) {
			errors.push({ tier: 'GraphQL POST', message: String(err) });
		}
	}

	// Tier 4: Embed fallback (username only — scrape recent posts page)
	if (context.type === 'username') {
		try {
			const result = await fetchViaEmbed(context.value, headers);
			if (result.nodes && result.nodes.length > 0) return { nodes: result.nodes, errors };
			if (result.error) errors.push(result.error);
		} catch (err) {
			errors.push({ tier: 'Embed', message: String(err) });
		}
	}

	if (errors.length > 0) {
		console.error(`All fetch tiers failed for ${context.type}:${context.value}:`, JSON.stringify(errors));
	}

	return { nodes: [], errors };
}

// Tier 1: REST API
async function fetchViaRestApi(username: string, headers: Record<string, string>): Promise<TierResult> {
	const url = `${IG_WEB_PROFILE}?username=${encodeURIComponent(username)}`;
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });

	if (!res.ok) {
		console.error(`[Tier 1 REST] HTTP ${res.status} for ${username}`);
		return { nodes: null, error: { tier: 'REST API', status: res.status, message: `HTTP ${res.status}` } };
	}

	if (isHtmlResponse(res)) {
		console.error(`[Tier 1 REST] Got HTML instead of JSON for ${username} (login redirect)`);
		return { nodes: null, error: { tier: 'REST API', status: res.status, message: 'Login redirect (cookies expired)' } };
	}

	const data: WebProfileInfoResponse = await res.json();
	const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges;
	if (!edges) {
		console.error(`[Tier 1 REST] No media edges for ${username}`);
		return { nodes: null, error: { tier: 'REST API', message: 'No media edges in response' } };
	}

	return { nodes: edges.map((e) => e.node) };
}

// Tier 2: GraphQL GET (query_hash)
async function fetchViaGraphQLGet(
	context: FeedContext,
	headers: Record<string, string>,
	env: Env,
	envRecord: Record<string, string | undefined>
): Promise<TierResult> {
	let queryHash: string;
	let variables: Record<string, unknown>;

	switch (context.type) {
		case 'username': {
			const userId = await resolveUserId(context.value, env);
			if (!userId) {
				return { nodes: null, error: { tier: 'GraphQL GET', message: 'Could not resolve user ID' } };
			}
			queryHash = envRecord['USER_QUERY_HASH'] || USER_QUERY_HASH;
			variables = { id: userId, first: RSS_ITEMS_LIMIT };
			break;
		}
		case 'hashtag': {
			queryHash = envRecord['TAG_QUERY_HASH'] || TAG_QUERY_HASH;
			variables = { tag_name: context.value, first: RSS_ITEMS_LIMIT };
			break;
		}
		case 'location': {
			queryHash = envRecord['TAG_QUERY_HASH'] || TAG_QUERY_HASH;
			variables = { id: context.value, first: RSS_ITEMS_LIMIT };
			break;
		}
	}

	const url = `${IG_GRAPHQL_QUERY}?query_hash=${queryHash}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });

	if (!res.ok) {
		console.error(`[Tier 2 GraphQL GET] HTTP ${res.status} for ${context.type}:${context.value}`);
		return { nodes: null, error: { tier: 'GraphQL GET', status: res.status, message: `HTTP ${res.status}` } };
	}

	if (isHtmlResponse(res)) {
		console.error(`[Tier 2 GraphQL GET] Got HTML for ${context.type}:${context.value} (login redirect)`);
		return { nodes: null, error: { tier: 'GraphQL GET', status: res.status, message: 'Login redirect (cookies expired)' } };
	}

	const data: GraphQLResponse = await res.json();

	let connection: MediaConnection | undefined;
	if (context.type === 'username') {
		connection = data?.data?.user?.edge_owner_to_timeline_media;
	} else if (context.type === 'hashtag') {
		connection = data?.data?.hashtag?.edge_hashtag_to_media;
	}

	if (!connection?.edges) {
		console.error(`[Tier 2 GraphQL GET] No edges for ${context.type}:${context.value}`);
		return { nodes: null, error: { tier: 'GraphQL GET', message: 'No edges in response' } };
	}
	return { nodes: connection.edges.map((e) => e.node) };
}

// Tier 3: GraphQL POST (doc_id)
async function fetchViaGraphQLPost(
	username: string,
	headers: Record<string, string>,
	env: Env,
	envRecord: Record<string, string | undefined>
): Promise<TierResult> {
	const userId = await resolveUserId(username, env);
	if (!userId) {
		return { nodes: null, error: { tier: 'GraphQL POST', message: 'Could not resolve user ID' } };
	}

	const docId = envRecord['USER_POSTS_DOC_ID'] || USER_POSTS_DOC_ID;
	const url = `${IG_BASE_URL}/api/graphql`;
	const body = new URLSearchParams({
		doc_id: docId,
		variables: JSON.stringify({
			id: userId,
			first: RSS_ITEMS_LIMIT,
		}),
	});

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			...headers,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: body.toString(),
		signal: AbortSignal.timeout(FETCH_TIMEOUT),
	});

	if (!res.ok) {
		console.error(`[Tier 3 GraphQL POST] HTTP ${res.status} for ${username}`);
		return { nodes: null, error: { tier: 'GraphQL POST', status: res.status, message: `HTTP ${res.status}` } };
	}

	if (isHtmlResponse(res)) {
		console.error(`[Tier 3 GraphQL POST] Got HTML for ${username} (login redirect)`);
		return { nodes: null, error: { tier: 'GraphQL POST', status: res.status, message: 'Login redirect (cookies expired)' } };
	}

	const data = (await res.json()) as {
		data?: {
			xdt_api__v1__feed__user_timeline_graphql_connection?: MediaConnection;
		};
	};

	const connection = data?.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
	if (!connection?.edges) {
		console.error(`[Tier 3 GraphQL POST] No edges for ${username}`);
		return { nodes: null, error: { tier: 'GraphQL POST', message: 'No edges in response' } };
	}

	return { nodes: connection.edges.map((e) => e.node) };
}

// Tier 4: Embed fallback — parse JSON from the user's profile page
async function fetchViaEmbed(username: string, headers: Record<string, string>): Promise<TierResult> {
	const url = `${IG_BASE_URL}/${encodeURIComponent(username)}/`;
	const res = await fetch(url, {
		headers: {
			...headers,
			Accept: 'text/html,application/xhtml+xml',
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT),
	});

	if (!res.ok) {
		console.error(`[Tier 4 Embed] HTTP ${res.status} for ${username}`);
		return { nodes: null, error: { tier: 'Embed', status: res.status, message: `HTTP ${res.status}` } };
	}

	const html = await res.text();

	// Try to extract embedded JSON data from the page
	const jsonMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
	if (!jsonMatch) {
		// Try the newer format
		const altMatch = html.match(/"xdt_api__v1__feed__user_timeline_graphql_connection":(\{.+?\})\s*[,}]/);
		if (!altMatch) {
			console.error(`[Tier 4 Embed] No embedded JSON found for ${username}`);
			return { nodes: null, error: { tier: 'Embed', message: 'No embedded JSON data in page' } };
		}

		try {
			const connection: MediaConnection = JSON.parse(altMatch[1]);
			return { nodes: connection.edges.map((e) => e.node) };
		} catch {
			return { nodes: null, error: { tier: 'Embed', message: 'Failed to parse embedded JSON (alt format)' } };
		}
	}

	try {
		const shared = JSON.parse(jsonMatch[1]);
		const edges = shared?.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges;
		if (!edges) {
			return { nodes: null, error: { tier: 'Embed', message: 'No edges in _sharedData' } };
		}
		return { nodes: edges.map((e: { node: MediaNode }) => e.node) };
	} catch {
		return { nodes: null, error: { tier: 'Embed', message: 'Failed to parse _sharedData JSON' } };
	}
}
