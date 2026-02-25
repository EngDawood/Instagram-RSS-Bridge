import type { Context } from 'hono';
import { Bot } from 'grammy';

type HonoEnv = { Bindings: Env };

export const BOT_COMMANDS = [
	{ command: 'start', description: 'Show all commands' },
	{ command: 'help', description: 'How to use the bot' },
	{ command: 'add', description: 'Register a channel: /add @channel' },
	{ command: 'sub', description: 'Subscribe to a source: /sub @channel @iguser' },
	{ command: 'unsub', description: 'Unsubscribe from a source' },
	{ command: 'list', description: 'List all subscriptions' },
	{ command: 'channels', description: 'List & manage channels' },
	{ command: 'status', description: 'Status overview' },
	{ command: 'seed', description: 'Mark source(s) as read' },
	{ command: 'delay', description: 'Set check interval in minutes' },
	{ command: 'set', description: 'Source format settings' },
	{ command: 'set_default', description: 'Channel default format' },
	{ command: 'enable', description: 'Enable a channel' },
	{ command: 'disable', description: 'Disable a channel' },
	{ command: 'test', description: 'Fetch & send latest post' },
	{ command: 'debug', description: 'Test Instagram connectivity' },
	{ command: 'cancel', description: 'Cancel current action' },
];

export async function handleSetup(c: Context<HonoEnv>): Promise<Response> {
	const bot = new Bot(c.env.TELEGRAM_BOT_TOKEN);

	await bot.api.setMyCommands(BOT_COMMANDS);
	await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });

	return c.json({ ok: true, commands: BOT_COMMANDS.length });
}
