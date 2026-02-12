import { IG_APP_ID, IG_BASE_URL, USER_AGENT } from '../constants';

// Cookie names that Instagram expects (set via .dev.vars or wrangler secrets)
const COOKIE_KEYS = ['sessionid', 'ds_user_id', 'csrftoken', 'rur', 'datr', 'ig_did', 'ig_nrcb', 'dpr', 'wd'] as const;

export function buildHeaders(env: Env): Record<string, string> {
	const headers: Record<string, string> = {
		'x-ig-app-id': IG_APP_ID,
		'User-Agent': USER_AGENT,
		'Accept-Language': 'en-US,en;q=0.9',
		Accept: '*/*',
		// Browser-like headers to reduce bot detection
		'Referer': `${IG_BASE_URL}/`,
		'Origin': IG_BASE_URL,
		'Sec-Fetch-Dest': 'empty',
		'Sec-Fetch-Mode': 'cors',
		'Sec-Fetch-Site': 'same-origin',
		'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
		'Sec-Ch-Ua-Mobile': '?0',
		'Sec-Ch-Ua-Platform': '"Windows"',
		'X-Requested-With': 'XMLHttpRequest',
	};

	// Build cookie string from all available env vars
	const envRecord = env as unknown as Record<string, string | undefined>;
	const cookies: string[] = [];

	// Primary cookies (from IG_SESSION_ID / IG_DS_USER_ID secrets)
	if (env.IG_SESSION_ID) cookies.push(`sessionid=${env.IG_SESSION_ID}`);
	if (env.IG_DS_USER_ID) cookies.push(`ds_user_id=${env.IG_DS_USER_ID}`);

	// Additional cookies from env (csrftoken, rur, datr, etc.)
	for (const key of COOKIE_KEYS) {
		if (key === 'sessionid' || key === 'ds_user_id') continue; // already added
		const value = envRecord[key];
		if (value) cookies.push(`${key}=${value}`);
	}

	if (cookies.length > 0) {
		headers['Cookie'] = cookies.join('; ');
	}

	// CSRF token header (Instagram checks this)
	if (envRecord['csrftoken']) {
		headers['x-csrftoken'] = envRecord['csrftoken'];
	}

	return headers;
}
