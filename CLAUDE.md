
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

Instagram RSS Bridge is a Cloudflare Worker that converts Instagram profiles, hashtags, and locations into RSS 2.0 feeds. Inspired by [RSS-Bridge's InstagramBridge](https://github.com/RSS-Bridge/rss-bridge/blob/master/bridges/InstagramBridge.php).

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
├── constants.ts              # Instagram API endpoints, query hashes, defaults
├── types/                    # TypeScript interfaces
│   ├── instagram.ts          # Instagram API response types
│   └── rss.ts                # RSS feed/item types
├── routes/
│   └── instagram.ts          # /instagram route handler (orchestration)
├── services/
│   ├── instagram-client.ts   # Multi-tier Instagram data fetching
│   ├── user-resolver.ts      # Username → ID resolution + KV cache
│   └── rss-builder.ts        # RSS 2.0 XML generation
└── utils/
    ├── headers.ts            # Instagram request header builder
    ├── media.ts              # MediaNode → RSS item conversion
    ├── text.ts               # Caption processing, hashtag/mention linking
    └── cache.ts              # KV cache helpers
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

```
GET /instagram?u=<username>                    # User feed
GET /instagram?h=<hashtag>                     # Hashtag feed
GET /instagram?l=<location_id>                 # Location feed
GET /instagram?u=<username>&media_type=video   # Filter: all|video|picture|multiple
GET /instagram?u=<username>&direct_links=true  # Use direct CDN URLs
GET /health                                    # Health check
```
