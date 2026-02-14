#!/usr/bin/env node
// Sends a Telegram message to the admin after deployment

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
	console.log('Skipping deploy notification: missing TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_ID');
	process.exit(0);
}

const message = `✅ <b>Deployed</b> instagram-rss-bridge\n🕐 ${new Date().toISOString()}`;

fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
})
	.then(r => r.json())
	.then(j => console.log(j.ok ? 'Admin notified of deployment' : 'Notify failed:', JSON.stringify(j)))
	.catch(e => console.error('Notify error:', e));
