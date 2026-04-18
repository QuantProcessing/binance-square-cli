# binance-square-cli

**English** · [简体中文](./README.zh-CN.md)

Unofficial CLI and MCP server for [Binance Square](https://www.binance.com/en/square). Binance does not expose a public API for Square, so this tool drives a headless Chromium (via Playwright) to sniff the browser's fingerprint headers once, then replays direct POST/GET calls against the internal `/bapi/composite/*` endpoints.

Read-only. No login required.

## Why Playwright (not raw HTTP)

Binance's front-end attaches a handful of fingerprint headers to every API call via an axios interceptor — `bnc-uuid`, `csrftoken`, `device-info` (base64 JSON with canvas/WebGL/audio fingerprints), `x-trace-id`, etc. Calls made without them come back with `data: null`. Rather than reproduce the fingerprint algorithm, this tool opens `/en/square` in a real browser, grabs the first composite request's headers, and reuses them for subsequent calls (with fresh `x-trace-id` per request).

Cold start: ~5s. Each subsequent request: ~200ms.

## Install

```bash
npm install
# postinstall fetches Chromium (~150MB)
```

Build the TypeScript:

```bash
npm run build
```

## CLI

```bash
# Homepage recommended feed
node dist/index.js feed --pretty
node dist/index.js feed --page 2 --size 20

# Fetch N consecutive pages with automatic cross-page dedup
node dist/index.js feed --pretty --pages 3

# Seed the server-side dedup list with ids you've already seen
node dist/index.js feed --pretty --exclude-ids 313714906103617,313590566577730

# User profile (by username, or by squareUid with --uid)
node dist/index.js user gzsq1234 --pretty
node dist/index.js user New5jCFqC0D5Opz178dklQ --uid --pretty

# A user's posts (uses current time as default cursor)
node dist/index.js user-posts New5jCFqC0D5Opz178dklQ --pretty
node dist/index.js user-posts New5jCFqC0D5Opz178dklQ --time-offset 1775004554999

# Single post detail
node dist/index.js post 303702474979186 --pretty

# Generic scraper fallback — visit any Square URL and dump captured JSON responses
node dist/index.js visit https://www.binance.com/en/square --debug
```

Shared flags for all API commands:

| Flag | Meaning |
| --- | --- |
| `--pretty` | Compact view (id / author / time / stats / url) |
| `--raw` | Full `ComposeResponse` envelope |
| `--headful` | Show the browser window (debugging) |
| `--debug` | Log diagnostics to stderr (sniffed headers, etc.) |
| `--lang <code>` | URL locale: `en` (default), `zh-CN`, `zh-TW`, `ja`, `ko`, ... |

Default output: `resp.data` unwrapped.

`--lang` switches the `/<lang>/square` URL the browser opens — the sniffed `lang` header then flows into every API call, so Binance returns localized fields (e.g. user tags `"低频交易者"` vs `"Occasional Trader"`). For long-lived server / MCP processes set `BSQ_LANG=zh-CN` in the environment instead.

## MCP server

Stdio transport, four tools:

| Tool | Purpose |
| --- | --- |
| `square_feed` | Homepage recommended feed (supports `pages` for multi-page dedup and `excludeIds` to skip seen posts) |
| `square_user` | User profile (by `username` or `squareUid`) |
| `square_user_posts` | Paginated posts by `squareUid` (cursor: `timeOffset`) |
| `square_post` | Single post detail including body text |

All tools accept `raw: true` to return the full envelope; default is the compact view (~1–3KB) to keep LLM context cheap.

### Run it

```bash
npm run mcp                        # dev (tsx)
node dist/mcp.js                   # built
BSQ_LANG=zh-CN node dist/mcp.js    # Chinese locale
```

Language is set per-process via `BSQ_LANG` (default `en`) — switching languages requires restarting the server, as it affects the single long-lived browser's sniffed headers.

### Wire into Claude Code / Desktop / Cursor

`.mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "binance-square": {
      "command": "node",
      "args": ["/absolute/path/to/binance-square-cli/dist/mcp.js"]
    }
  }
}
```

Docker variant:

```json
{
  "mcpServers": {
    "binance-square": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--entrypoint", "node", "bsq", "dist/mcp.js"]
    }
  }
}
```

The server keeps one long-lived `SquareClient` across the whole session — Chromium stays alive, sniffed headers are reused. Shuts down cleanly on `SIGINT` / `SIGTERM`.

## HTTP server

A thin Fastify wrapper over the same `SquareClient`, for consumption from other services. One long-lived browser shared across all requests.

```bash
npm run server                         # dev (tsx)
node dist/server.js                    # built
PORT=8080 node dist/server.js
BSQ_LANG=zh-CN node dist/server.js     # Chinese locale (process-level)
```

No auth, no cache — put it behind a reverse proxy / internal network if you need either. Language is fixed per-process via `BSQ_LANG`; to serve multiple languages, run multiple instances behind a router.

Endpoints (all GET):

| Route | Params |
| --- | --- |
| `/health` | — |
| `/feed` | `page`, `size`, `scene`, `pages`, `excludeIds` (csv) |
| `/user` | `username` **or** `squareUid` |
| `/user/:squareUid/posts` | `timeOffset`, `filterType` |
| `/post/:id` | — |

Output shape controlled by query flags:

- default: `resp.data` unwrapped
- `?pretty=1`: compact projection (id / author / time / stats / url)
- `?raw=1`: full `ComposeResponse` envelope

Examples:

```bash
curl 'http://localhost:3000/feed?pretty=1&pages=3'
curl 'http://localhost:3000/user?username=gzsq1234&pretty=1'
curl 'http://localhost:3000/user/New5jCFqC0D5Opz178dklQ/posts?pretty=1'
curl 'http://localhost:3000/post/303702474979186?pretty=1'
```

## Docker

```bash
docker build -t bsq .

docker run --rm bsq feed --pretty
docker run --rm bsq feed --lang zh-CN --pretty
docker run --rm bsq user gzsq1234 --pretty
docker run --rm -e BSQ_LANG=zh-CN -i --entrypoint node bsq dist/mcp.js              # MCP mode
docker run --rm -e BSQ_LANG=zh-CN -p 3000:3000 --entrypoint node bsq dist/server.js # REST server
```

Base image: `mcr.microsoft.com/playwright:v1.48.0-jammy` (Chromium + CJK fonts preinstalled, so non-Latin post bodies render/serialize correctly).

## Known endpoints

| Purpose | Method | Path |
| --- | --- | --- |
| Feed | POST | `/bapi/composite/v9/friendly/pgc/feed/feed-recommend/list` |
| User profile | POST | `/bapi/composite/v3/friendly/pgc/user/client` |
| User posts | GET | `/bapi/composite/v2/friendly/pgc/content/queryUserProfilePageContentsWithFilter` |
| Post detail | GET | `/bapi/composite/v3/friendly/pgc/special/content/detail/{id}` |

All routed through a live Playwright page, so the axios interceptor's fingerprint headers are preserved.

## Schema quirks

- Feed uses `authorName` / `date` (**seconds**) / `cardType`; user-posts + post-detail use `displayName` / `createTime` (**milliseconds**) / `contentType`. The `--pretty` projection normalizes both.
- Post `body` is a layout-engine JSON blob. Use `bodyTextOnly` (what `--pretty` returns) for plain text.
- Feed `pageSize` is advisory — the server often returns ~21 items regardless (including a `KOL_RECOMMEND_GROUP` ad slot). Real pagination requires sending back every `id` you've already seen as `contentIds`; otherwise page 2 will overlap page 1. The `--pages N` flag (CLI) / `pages` param (MCP) handles this automatically; `--exclude-ids` / `excludeIds` seeds the dedup set manually.
- `user-posts` paginates by `timeOffset` (ms cursor). Next page = the `timeOffset` echoed in the previous response's `data`.

## Project layout

```
src/
  index.ts      CLI entry (commander)
  mcp.ts        MCP server (stdio)
  server.ts     HTTP server (Fastify)
  client.ts     SquareClient: browser lifecycle, header sniff, post()/get()
  scraper.ts    Response-interception fallback (for endpoints not yet reversed)
  browser.ts    Playwright launch helper
  pretty.ts     Compact projections for feed/user/post
  commands.ts   CLI command handlers
Dockerfile
```
