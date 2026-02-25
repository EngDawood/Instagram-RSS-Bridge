import { Hono } from 'hono';
import { handleInstagramFeed } from './routes/instagram';
import { handleTelegramWebhook } from './routes/telegram';
import { handleSetup } from './routes/setup';
import { checkAllFeeds } from './cron/check-feeds';

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/instagram', handleInstagramFeed);

app.post('/telegram/webhook', handleTelegramWebhook);
app.get('/telegram/setup', handleSetup);

app.notFound((c) =>
	c.json(
		{
			error: 'Not found',
			usage: {
				username: '/instagram?u=username',
				hashtag: '/instagram?h=hashtag',
				location: '/instagram?l=location_id',
				params: 'media_type=all|video|picture|multiple, direct_links=true|false',
			},
		},
		404
	)
);

app.onError((err, c) => {
	console.error('Unhandled error:', err);
	return c.json({ error: 'Internal Server Error' }, 500);
});

export default {
	fetch: app.fetch,
	scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
		ctx.waitUntil(checkAllFeeds(env));
	},
};
