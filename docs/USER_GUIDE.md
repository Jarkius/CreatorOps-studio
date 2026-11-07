# User guide: setup, usage and deployment

For the owner. Status of what works is in `docs/READY.md`; decisions are in `docs/DECISIONS.md`.

## 1. Setup (one machine, no Docker)

Needs Node 22+ and pnpm 10 (`corepack enable`, then `pnpm install` once).

```
pnpm demo
```

This starts PostgreSQL and Redis locally, builds the dashboard and the extension with mock sign-in, creates a `creatorops_demo` database (kept between runs) and runs the API, the worker and the dashboard at <http://localhost:5173>. Press Ctrl+C to stop; `pnpm dev:db:stop` and `pnpm dev:redis:stop` stop the databases.

**Load the extension:** Chrome, `chrome://extensions`, turn on Developer mode, Load unpacked, choose `apps/extension/dist`. Pin it and click the icon to open the side panel. (Use the demo build: a plain `pnpm build` has no sign-in and says "Sign-in is not configured yet".)

**Real text instead of the free mock writer:**

1. Make an encryption key and give it to the API and the worker: `export SECRETS_ENCRYPTION_KEY="$(openssl rand -base64 32)"` before `pnpm demo` (keep it; losing it means re-entering keys).
2. Dashboard, Settings: choose the provider (OpenRouter, or Custom for MaxPlus: `https://api.maxplus-ai.cc/v1`), the model, the key, and the prices. For MaxPlus see `docs/MAXPLUS_MODELS.md` (about 0.08 USD per request; "Baht per 1 USD" 0.3333).
3. Press **Check connection**, then generate once and read Usage. The key is stored encrypted and never shown again. MaxPlus is for development and pilot use only (D-062).

## 2. Using it

**Side panel (quick entry)**

- **Create content:** pick a product and press the button; it makes a campaign and writes the script. Tick **Full Auto** to also make the four scene images in Meta AI.
- **Campaigns:** status, cancel, cost line in baht, link to the dashboard.
- **Scenes:** four editable prompts with Copy. **Generate in Meta AI** makes one image in your own signed-in meta.ai tab; **Write video prompts** makes four English video prompts with a Thai voiceover each; **Make video in Flow** uses them in your own flow.google.com tab (set 9:16 first). Chrome asks once to allow each site; nothing is typed until you press the button, and you sign in yourself.
- **Shopee Affiliate:** open your affiliate product list in a tab, press Import. Tick **Load more of the list** to scroll and press Next up to 10 steps (fixed 2 s wait, Stop loading button). It stops at any Shopee check, slow-down notice or sign-in page; finish those yourself. Sort by commission or earning per sale, then **Create product**.
- Any failure: **Copy diagnostics** and send it.

**Dashboard (full workspace):** Products (Shopee imports are marked), Asset library, Campaigns and drafts (edit, regenerate a section, status, claim warnings, video prompts, attach pictures, **Export ZIP package** and download), Costs (per campaign and per month), Settings.

## 3. Deployment

**What exists:** a single-machine setup for one user (above). `AUTH_MODE=mock` hands out tokens without credentials, so the API refuses to start with it in production and it must never face a network (`ALLOW_MOCK_AUTH_ON_NETWORK` exists for deliberate exceptions only).

**What does not exist yet:** hosted deployment. It needs three owner decisions first (D-022 and D-060): **Q-003** a real sign-in provider, **Q-004** an object-storage vendor (uploads and exports use the local `DATA_DIR`; the API and the worker must share it), **Q-007** a hosting target. Also before outside testers: a published extension id (Q-006) and pinned GitHub Actions (never run yet).

**When you are ready, the pieces are:** PostgreSQL 16 with the committed migrations (`infra/migrations`, applied by `apps/api/dist/db/cli.js`), Redis 7 (`REDIS_URL`), the API (`apps/api/dist/server.js`), the worker (`apps/api/dist/worker.js`), the dashboard's static build, and the extension built with `pnpm --filter @creatorops/extension build:store`. Variables are in `.env.example`: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (long random), `SECRETS_ENCRYPTION_KEY`, `API_BASE_URL`, `WEB_ORIGIN`, `EXTENSION_ORIGIN`, `DATA_DIR`, `NODE_ENV=production`, `TRUST_PROXY_HOPS` when behind a proxy. Do not publish until Q-003, Q-004 and Q-007 are answered.

## 4. Problems

| Symptom | Try |
|---|---|
| "Sign-in is not configured yet" in the panel | load the demo build (`pnpm demo` builds it), not a plain `pnpm build` |
| Settings says a key cannot be saved | set `SECRETS_ENCRYPTION_KEY` for the API and the worker, restart |
| Generation stays "Waiting to start" | the worker is not running or has no `REDIS_URL` |
| `ECONNREFUSED 5432` | PostgreSQL is down: `pnpm dev:db` |
| A helper says the page is not recognised | Copy diagnostics, send it; the fix is a small edit in `selectors.ts` / `sites.ts` |
| Shopee or Flow shows a check | finish it in that tab yourself; the helper does not solve it |
| Export download gives 404 | the API and the worker use different `DATA_DIR` folders |
