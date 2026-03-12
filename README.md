# Instagram RSS Bridge (Cloudflare Worker)

A high-performance Cloudflare Worker that provides an RSS bridge for Instagram and a powerful Telegram bot for automated feed distribution and media downloading.

## 🚀 Features

### 1. RSS Endpoint
Converts Instagram content into clean RSS 2.0 XML. Supports multiple content types:
- **User Feeds**: `@username`
- **Hashtags**: `#hashtag`
- **Locations**: Location ID based feeds
- **Filtering**: Filter by media type (photo, video, album)
- **Direct Links**: Option to use direct CDN URLs for media

### 2. Telegram Admin Bot
A feature-rich bot to manage your feeds and subscriptions:
- **Subscription Management**: Add/remove Instagram users and generic RSS feeds to Telegram channels.
- **Automated Posting**: Periodic checking of feeds (via Cron) and automatic posting to configured channels.
- **Customizable Formatting**: Per-channel and per-source formatting settings (author display, media toggles, source links, notification muting).
- **Fallback Logic**: Smart handling of large media files with automatic fallback to "Thumbnail + Link" or "Skip" modes.
- **Failed Posts Log**: Admin interface to view and manage posts that failed to send due to Telegram limits.

### 3. Universal Media Downloader
Supports downloading and sending media from 9+ platforms directly through the Telegram bot:
- Instagram, TikTok, Twitter/X, YouTube, Facebook, Threads, SoundCloud, Spotify, and Pinterest.
- Features include quality selection for YouTube/Facebook and automatic slideshow handling for TikTok.

---

## 🛠️ Prerequisites

- A **Cloudflare account** with Workers and KV enabled.
- A **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather)).
- **Instagram Session Cookies** (`sessionid` and `ds_user_id`) for authenticated fetching.

---

## ⚙️ Installation & Setup

### 1. Clone and Install
```bash
git clone <repository-url>
cd rss-bridge
npm install
```

### 2. Configure KV Namespace
Create a KV namespace named `CACHE` in your Cloudflare dashboard or via CLI:
```bash
npx wrangler kv namespace create CACHE
```
Update the `kv_namespaces` ID in `wrangler.jsonc` with the ID provided by the command.

### 3. Set Secrets
Use Wrangler to securely set your sensitive credentials:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ADMIN_TELEGRAM_ID
npx wrangler secret put IG_SESSION_ID
npx wrangler secret put IG_DS_USER_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

### 4. Deploy
```bash
npm run deploy
```

---

## 📖 Usage & Commands

### Development
- `npm run dev`: Start a local development server on port 8787.
- `npm run cf-typegen`: Regenerate TypeScript types from your Wrangler configuration.

### RSS API Endpoints
- `GET /instagram?u=<username>`: Fetch user feed.
- `GET /instagram?h=<hashtag>`: Fetch hashtag feed.
- `GET /instagram?u=<username>&media_type=video`: Filter by `all|video|photo|album`.
- `GET /instagram?u=<username>&direct_links=true`: Use direct CDN URLs.

### Telegram Bot Commands
- `/start` / `/help`: Show usage information.
- `/add @channel`: Register a new Telegram channel for management.
- `/channels`: List all registered channels.
- `/sub @channel <source>`: Subscribe a channel to a source (IG username or RSS URL).
- `/unsub @channel <source>`: Unsubscribe from a source.
- `/status`: Show current subscriptions and their status.
- `/format`: Open the interactive formatting settings menu.
- `/debug` / `/test`: Run diagnostic checks.

---

## 🏗️ Architecture

- **Hono**: High-performance web framework for routing.
- **grammY**: Robust Telegram Bot framework.
- **Cloudflare KV**: Used for caching RSS XML (15min), user IDs (24h), and storing channel configurations.
- **Modular Services**: Separate logic for feed fetching, media downloading, and RSS generation.
- **Cron Triggers**: Automated feed checking every 5 minutes (configurable in `wrangler.jsonc`).

## 🔧 Configuration (wrangler.jsonc)
The `vars` section allows you to customize TTL and default behaviors:
- `USER_ID_CACHE_TTL`: How long to cache Instagram user IDs (default 86400s).
- `FEED_CACHE_TTL`: How long to cache rendered RSS XML (default 900s).
- `ADMIN_TELEGRAM_ID`: Your Telegram User ID (to restrict bot access).
- `WORKER_URL`: The public URL of your deployed worker.

---

## 📜 License
Private Project. All rights reserved.
