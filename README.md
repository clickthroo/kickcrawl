# Kickcrawl

A self-hosted web crawler that replaces Firecrawl for Kickio's football-shirt
marketplace scraping. It exposes the same four core operations Firecrawl
does — scrape, map, crawl, extract — behind a near-identical JSON API, backed
by a persistent Postgres map of every URL discovered per site and an admin
dashboard for configuring sites and monitoring jobs.

## Why this exists

Kickio was paying Firecrawl to re-fetch the same retailer pages (Classic
Football Shirts, Vintage Football Shirts, Vinted stores, eBay, Shopify
stores) over and over. This app fetches pages directly — Cheerio for static
HTML, a Playwright fallback for JS-heavy or bot-protected pages — stores
what it finds, and lets an admin tune rate limits, selectors and browser use
per site once, instead of paying per request indefinitely.

## Stack

- **API**: Node.js + TypeScript + Fastify (`apps/api`)
- **Rendering**: Cheerio for fast static parsing, Playwright (Chromium) as
  the fallback for JS-heavy/challenge pages
- **Database**: PostgreSQL
- **Queue**: BullMQ + Redis for background crawl jobs
- **Admin UI**: React + Tailwind CSS, built with Vite (`apps/admin`), served
  as static files by the API in production
- **Auth**: API keys (SHA-256 hashed, `Bearer` header) for Kickio's server
  calls; signed-cookie session login for the admin UI

## Project layout

```
apps/
  api/      Fastify server: /api/v1/* (public API) and /api/admin/* (dashboard)
  admin/    React admin dashboard (Vite build output served by the API)
```

## Local development

Requires Docker (for Postgres/Redis) and Node.js 22+.

```bash
cp .env.example .env
# generate a bcrypt hash for your admin password and put it in ADMIN_PASSWORD_HASH:
node -e "require('bcryptjs').hash('yourpassword', 10).then(console.log)"

docker compose up --build
```

This boots Postgres, Redis, and the app (migrations run automatically on
startup). The admin dashboard and API are both served from
`http://localhost:3000`.

To run the API and admin UI separately with hot reload instead:

```bash
npm install
docker compose up postgres redis   # just the datastores
npm run dev:api                    # Fastify on :3000, tsx watch
npm run dev:admin                  # Vite dev server on :5173, proxies /api to :3000
```

### Tests

```bash
npm test
```

Runs the API's unit test suite (Vitest) — markdown conversion, link
extraction/path matching, block-page detection, API key hashing, session
tokens, selector extraction, and the per-domain rate limiter. These don't
require a live database.

## Environment variables

See `.env.example` for the full list. The essentials:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string (BullMQ) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` | Bootstraps the first admin login on startup |
| `SESSION_SECRET` | Signs admin session cookies — set a real random value in production |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Fallback LLM extraction when a site has no working selectors |
| `PROXY_URL` | Upstream proxy used when a site has "use proxy" enabled |
| `WEBHOOK_URL` | Optional POST notification when a crawl job completes |

## API reference

All `/api/v1/*` routes require `Authorization: Bearer <api_key>` (create keys
in the admin UI under **API Keys**).

### `POST /api/v1/scrape`

```json
{ "url": "https://example.com/shirt/123", "formats": ["markdown", "html", "links"], "onlyMainContent": true }
```

Returns `{ success, markdown, html, links, metadata, extracted }` — see
`apps/api/src/routes/scrape.ts`. Set `useBrowser: true` to force a Playwright
render; otherwise the server tries a plain fetch first and retries once via
Playwright if it detects a block/challenge page.

### `POST /api/v1/map`

```json
{ "url": "https://example.com", "search": "shirt", "limit": 5000 }
```

Reads `robots.txt` + `sitemap.xml` (recursing into nested sitemaps) first;
falls back to a depth-2 crawl of the homepage if no sitemap exists. Every
URL found is persisted against the site. Returns `{ success, links, total }`.

### `POST /api/v1/crawl` + `GET /api/v1/crawl/:jobId`

Queues a background BullMQ job that walks internal links up to `maxDepth`,
respecting `includePaths`/`excludePaths` and the `limit` cap, scraping each
page with `scrapeOptions`. Poll the job endpoint for `status` (`queued` →
`running` → `completed`/`failed`), `completed`/`total` counts, and the final
`data` array once completed.

### `POST /api/v1/extract`

```json
{ "url": "https://example.com/shirt/123", "schema": { "title": "string", "price": "string", "in_stock": "boolean" } }
```

Tries the site's saved CSS selectors first; falls back to an
OpenAI-compatible chat completion for any fields selectors couldn't fill.
Results are cached per URL+schema for 24 hours.

### `POST /api/v1/screenshot` (bonus)

`{ "url": "...", "fullPage": false }` → `{ success, screenshot: "data:image/png;base64,..." }`.

## Admin dashboard

Log in at `/` with the bootstrapped admin account:

- **Dashboard** — pages fetched today/this week, success rate, top sites, queue depth
- **Sites** — add/edit sites: rate limit, max depth, browser/proxy defaults, default selectors, allowed/denied paths
- **Site detail** — browse discovered URLs, filter by status/path, re-scrape any single URL, trigger a map run
- **Jobs / Job detail** — status, progress, page log, errors, re-run crawl jobs
- **API keys** — generate/delete keys (plaintext shown once on creation)
- **Settings** — global rate limit, default user-agent, proxy, LLM provider/model, notification email, webhook URL

## Anti-bot behaviour

- Rotates a small pool of realistic desktop browser user-agents
- Respects `robots.txt` disallow rules and `Crawl-delay`
- Per-domain rate limiting with jitter, driven by each site's configured RPS
- Detects block/challenge pages (403/429/503, "Just a moment", "checking
  your browser", etc.) and retries once via Playwright; routes that retry
  through `PROXY_URL` if the site has "use proxy" enabled
- Caps every crawl at its configured `limit` and marks persistently-failing
  URLs `failed` rather than looping on them

## Deployment

### Docker (VPS or any Docker host)

```bash
docker compose -f docker-compose.yml up --build -d
```

For production, run `app` behind a reverse proxy (Caddy/Nginx) for TLS, and
point `DATABASE_URL`/`REDIS_URL` at managed Postgres/Redis if you don't want
to run them in containers yourself.

### Railway

1. Create a new Railway project from this repo — it picks up `railway.json`
   and builds via the included `Dockerfile`.
2. Add **Postgres** and **Redis** plugins to the project.
3. On the app service, set `DATABASE_URL` and `REDIS_URL` to reference the
   plugins (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`), plus
   `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, and optionally
   `OPENAI_API_KEY`/`PROXY_URL`.
4. Deploy. Migrations run automatically on container start.

### Render

Use the Dockerfile with a Render **Web Service**, plus a managed Postgres
instance and a Redis instance (Render Key Value or an external Redis). Set
the same environment variables as above.

## Migrating Kickio off Firecrawl

1. Deploy this app (Docker Compose locally, or Railway/Render/VPS for real
   traffic) and create an admin login + at least one API key.
2. In the admin UI, add **Classic Football Shirts** as a site (base URL,
   sensible rate limit, e.g. 1 rps), then open its detail page and click
   **Run map** to build the initial URL list.
3. In Kickio's scraper code, change the Firecrawl base URL and API key to
   this app's URL and the new API key — the `/scrape`, `/map`, `/crawl`,
   `/extract` request/response shapes are close enough that this should be
   close to a drop-in swap (see the differences below).
4. Run Kickio's scraper against this app and against Firecrawl for the same
   source in parallel; diff the outputs (markdown content, extracted
   fields, link counts) before trusting it fully.
5. Move sources over one at a time — plain HTML retailer sites first, then
   Shopify stores, then eBay/Vinted (more bot-protection, more likely to
   need `use_browser_default: true` or a proxy). Keep Firecrawl as a
   fallback for anything still failing.
6. Once every source is stable here, remove the Firecrawl integration and
   API key from Kickio.

### Known differences from Firecrawl's API

- Responses are close to Firecrawl v2's shape but not byte-identical (no
  `warning`/`creditsUsed` fields, `extracted` instead of nested
  `llm_extraction`). Check `apps/api/src/lib/scrapeCore.ts` and the route
  files under `apps/api/src/routes/` for the exact shape before wiring up
  strict response validation on Kickio's side.
- `/api/v1/crawl` polling returns `data` only once `status: "completed"`;
  Firecrawl streams partial results as pages complete. Poll interval of a
  few seconds is recommended.
- Extraction schemas here are a flat `{ field: "string" | "number" |
  "boolean" }` map, not full JSON Schema.

## Database schema

See `apps/api/src/migrations/*.sql`. Core tables: `sites`, `urls`, `jobs`,
`api_keys`, `scrape_results`, plus `extract_cache` (24h extract cache),
`admin_users` and `settings` (admin login + global config) added in
`002_extract_cache_and_admin.sql`. Migrations run automatically on every
app startup (`apps/api/src/lib/migrate.ts`).
