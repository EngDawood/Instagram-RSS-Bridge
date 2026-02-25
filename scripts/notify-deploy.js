#!/usr/bin/env node
// Registers Telegram webhook and sends deploy notification to admin

const fs = require('fs');

function getVar(name) {
	if (process.env[name]) return process.env[name].trim();
	try {
		const vars = fs.readFileSync('.dev.vars', 'utf8');
		const match = vars.match(new RegExp(`${name}=(.+)`));
		return match?.[1]?.trim();
	} catch { return null; }
}

const token = getVar('TELEGRAM_BOT_TOKEN');
const chatId = getVar('ADMIN_TELEGRAM_ID');

if (!token || !chatId) {
	console.log('Skipping deploy tasks: missing TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_ID');
	process.exit(0);
}

(async () => {
	// 1. Register webhook with correct allowed_updates
	const webhookSecret = getVar('TELEGRAM_WEBHOOK_SECRET');
	const webhookUrl = 'https://rss-bridge.engdawood.workers.dev/telegram/webhook';

	try {
		const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				url: webhookUrl,
				allowed_updates: ['message', 'callback_query'],
				...(webhookSecret && { secret_token: webhookSecret }),
			}),
		});
		const json = await res.json();
		console.log(json.ok ? 'Webhook registered' : 'Webhook setup failed:', JSON.stringify(json));
	} catch (e) {
		console.error('Webhook setup error:', e);
	}

	// 2. Send deploy notification
	const message = `✅ <b>Deployed</b> rss-bridge\n🕐 ${new Date().toISOString()}`;

	try {
		const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
		});
		const json = await res.json();
		console.log(json.ok ? 'Admin notified of deployment' : 'Notify failed:', JSON.stringify(json));
	} catch (e) {
		console.error('Notify error:', e);
	}
})();
