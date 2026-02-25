
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## AI Guidance

* Ignore GEMINI.md and GEMINI-*.md files
* To save main context space, for code searches, inspections, troubleshooting or analysis, use code-searcher subagent where appropriate - giving the subagent full context background for the task(s) you assign it.
* ALWAYS read and understand relevant files before proposing code edits. Do not speculate about code you have not inspected. If the user references a specific file/path, you MUST open and inspect it before explaining or proposing fixes. Be rigorous and persistent in searching code for key facts. Thoroughly review the style, conventions, and abstractions of the codebase before implementing new features or abstractions.
* After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action.
* After completing a task that involves tool use, provide a quick summary of what you've done.
* For maximum efficiency, whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially.
* Before you finish, please verify your solution
* Do what has been asked; nothing more, nothing less.
* NEVER create files unless they're absolutely necessary for achieving your goal.
* ALWAYS prefer editing an existing file to creating a new one.
* NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
* If you create any temporary new files, scripts, or helper files for iteration, clean up these files by removing them at the end of the task.
* When you update or modify core context files, also update markdown documentation and memory bank
* When asked to commit changes, exclude CLAUDE.md and CLAUDE-*.md referenced memory bank system files from any commits. Never delete these files.

<investigate_before_answering>
Never speculate about code you have not opened. If the user references a specific file, you MUST read the file before answering. Make sure to investigate and read relevant files BEFORE answering questions about the codebase. Never make any claims about code before investigating unless you are certain of the correct answer - give grounded and hallucination-free answers.
</investigate_before_answering>

<do_not_act_before_instructions>
Do not jump into implementatation or changes files unless clearly instructed to make changes. When the user's intent is ambiguous, default to providing information, doing research, and providing recommendations rather than taking action. Only proceed with edits, modifications, or implementations when the user explicitly requests them.
</do_not_act_before_instructions>

<use_parallel_tool_calls>
If you intend to call multiple tools and there are no dependencies between the tool calls, make all of the independent tool calls in parallel. Prioritize calling tools simultaneously whenever the actions can be done in parallel rather than sequentially. For example, when reading 3 files, run 3 tool calls in parallel to read all 3 files into context at the same time. Maximize use of parallel tool calls where possible to increase speed and efficiency. However, if some tool calls depend on previous calls to inform dependent values like the parameters, do NOT call these tools in parallel and instead call them sequentially. Never use placeholders or guess missing parameters in tool calls.
</use_parallel_tool_calls>

## Project Overview

Instagram RSS Bridge is a Cloudflare Worker with two main features:
1. **RSS Endpoint** — Converts Instagram profiles, hashtags, and RSS feeds to RSS 2.0 XML
2. **Telegram Bot** — Admin bot for managing channel subscriptions and auto-posting from feeds via cron

Inspired by [RSS-Bridge's InstagramBridge](https://github.com/RSS-Bridge/rss-bridge/blob/master/bridges/InstagramBridge.php) and [RSS-to-Telegram-Bot](https://github.com/Rongronggg9/RSS-to-Telegram-Bot).

## Commands

- `npm run dev` — Start local dev server (port 8787)
- `npm run deploy` — Deploy to Cloudflare
- `npm run cf-typegen` — Regenerate worker-configuration.d.ts from wrangler.jsonc
- `npx wrangler secret put IG_SESSION_ID` — Set Instagram session cookie
- `npx wrangler secret put IG_DS_USER_ID` — Set Instagram user ID cookie
- `npx wrangler kv namespace create CACHE` — Create KV namespace

## Architecture

```
src/
├── index.ts                  # Hono app entry point, routes
├── constants.ts              # Instagram API endpoints, query hashes, Telegram defaults
├── types/                    # TypeScript interfaces
│   ├── instagram.ts          # Instagram API response types
│   ├── rss.ts                # RSS feed/item types
│   ├── telegram.ts           # Telegram bot types (ChannelConfig, FormatSettings, etc.)
│   └── feed.ts               # Universal feed item types
├── routes/
│   ├── instagram.ts          # /instagram route handler (RSS endpoint)
│   └── telegram.ts           # /telegram webhook route (bot updates)
├── services/
│   ├── instagram-client.ts   # RSS-Bridge fetching (primary)
│   ├── instagram-fetcher.ts  # Multi-tier fetch orchestration
│   ├── media-downloader.ts   # Multi-platform media downloader (btch API, 9 platforms)
│   ├── feed-fetcher.ts       # Generic RSS/Atom feed parser
│   ├── user-resolver.ts      # Username → ID resolution + KV cache
│   ├── rss-builder.ts        # RSS 2.0 XML generation
│   └── telegram-bot/         # Modular Telegram bot
│       ├── index.ts          # Re-exports createBot, getChannelConfig, etc.
│       ├── bot-factory.ts    # Bot instance creation, middleware, error handling
│       ├── commands/         # /start, /add, /sub, /channels, /format, /debug
│       ├── callbacks/        # Inline keyboard callback handlers (incl. download-callbacks)
│       ├── handlers/         # Multi-step flows (add source, fetch & send, download-and-send)
│       ├── helpers/          # Shared utilities (channel resolver, fallback sender)
│       ├── storage/          # KV operations (channel configs, admin state)
│       └── views/            # Keyboard builders, message formatters
├── cron/
│   └── check-feeds.ts        # Scheduled job: fetch feeds & send to channels
└── utils/
    ├── headers.ts            # Instagram request header builder
    ├── media.ts              # MediaNode → RSS item conversion
    ├── text.ts               # HTML escaping, caption processing
    ├── cache.ts              # KV cache helpers
    ├── url-detector.ts       # Platform URL detection (9 platforms)
    └── telegram-format.ts    # FeedItem → Telegram message formatting
```

## Conventions

- TypeScript strict mode
- Hono framework for routing
- KV for caching (feed XML cached 15min, user IDs cached 24h)
- No heavy dependencies — RSS XML built manually, no HTML parser
- Env type comes from worker-configuration.d.ts (generated from wrangler.jsonc)
- Run `npm run cf-typegen` after changing wrangler.jsonc bindings

## Data flow

1. Request hits `/instagram?u=username`
2. Check KV cache for rendered RSS XML → return on hit
3. Fetch Instagram data via multi-tier fallback (REST → GraphQL GET → GraphQL POST → embed scraping)
4. Filter by media_type, convert MediaNode[] to RSSItem[]
5. Build RSS 2.0 XML, cache in KV, return

## Instagram auth

Session cookies (`IG_SESSION_ID`, `IG_DS_USER_ID`) are required for reliable access. Set via `wrangler secret put` for production, or in `.dev.vars` for local dev. Use a dedicated Instagram account.

## API

### RSS Endpoint
```
GET /instagram?u=<username>                    # User feed
GET /instagram?h=<hashtag>                     # Hashtag feed
GET /instagram?l=<location_id>                 # Location feed
GET /instagram?u=<username>&media_type=video   # Filter: all|video|picture|multiple
GET /instagram?u=<username>&direct_links=true  # Use direct CDN URLs
GET /health                                    # Health check
```

### Telegram Bot
```
POST /telegram                                 # Webhook endpoint for bot updates
```

**Bot commands:**
- `/start`, `/help` — Info and usage
- `/add @channel` — Register a Telegram channel
- `/sub @channel @iguser` — Subscribe to Instagram user (no initial fetch)
- `/sub @channel @iguser 5` — Subscribe + fetch 5 latest posts
- `/unsub @channel source` — Unsubscribe from source
- `/channels` — List registered channels
- `/status` — Show all subscriptions
- `/format` — Configure message formatting (author, media, source link, etc.)
- `/debug`, `/test` — Diagnostic commands

**Media download:** Send a supported URL (TikTok, Instagram, Twitter/X, YouTube, Facebook, Threads, SoundCloud, Spotify, Pinterest) to the bot to download and receive media. YouTube offers quality picker. Facebook offers HD/SD picker. TikTok offers Video/Audio picker (image slideshows auto-download). Threads supports both `threads.net` and `threads.com` domains.

**Media send strategy (URL-first):** `send-media.ts` always tries Telegram URL pass-through first (no host whitelist). If Telegram can't fetch the URL, interactive mode shows `[📥 Download] [❌ Cancel] [📤 Send to @urluploadxbot]` buttons with the direct URL in monospace. Cron/channel posting auto-falls back to download+upload silently. Files >50MB show the URL + @urluploadxbot button. `TelegramUrlFetchError` is thrown on URL rejection in interactive mode; `downloadAndSendMedia` catches it and stores `directMediaUrl` in KV for the `dl:confirm` callback. Twitter/Threads/Pinterest deduplicate AIO quality variants to single best video.

**Cron job:** `check-feeds.ts` runs every N minutes (configurable per channel), fetches new posts, sends to Telegram channels.
