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
- **Shopee Affiliate:** open your affiliate product list in a tab, press Import. Tick **Load more of the list** to scroll and press Next up to 10 steps (fixed 2 s wait, Stop loading button). It stops at any Shopee check, slow-down notice or sign-in page; finish those yourself. Sort by commission or earning per sale, then **Create product**: it also saves that product's photo from your tab as the product's cover (if the photo cannot be saved, the product is still made and the row says why).
- Any failure: **Copy diagnostics** and send it.

**Dashboard (full workspace):** Products (Shopee imports are marked), Asset library, Campaigns and drafts (edit, regenerate a section, status, claim warnings, video prompts, attach pictures, **Make final video**, **Export ZIP package** and download), Costs (per campaign and per month), Settings.

**Final video:** after Flow has made the scene videos (side panel, Scenes) and Write video prompts has run for this version of the draft, open the draft in the dashboard and press **Make final video**. It joins the scene videos in order into one 9:16 MP4 with Thai subtitles from the voiceover lines, adds it to the draft's files, and offers **Copy subtitles (.srt)**; press **Export ZIP package** again to put it in a package (older packages do not have it). It needs ffmpeg with libx264 and libass on the computer that runs the worker: macOS `brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg` (Homebrew's plain `ffmpeg` has no libass, so it cannot draw subtitles; run `brew uninstall ffmpeg` first if you have it); Windows `winget install Gyan.FFmpeg` (not checked); Ubuntu `sudo apt install ffmpeg fonts-thai-tlwg`. The worker log says at start what your ffmpeg can do. Without libass the video is still made, without burned-in subtitles, and the .srt is offered. Optional: `SUBTITLE_FONT` (macOS Thonburi, Windows Leelawadee UI). Voice: with **Flow speaks the Thai voiceover** ticked (Scenes, on by default) each Flow clip is asked to speak its Thai line, and the final video keeps the clips' sound; pick a Flow model that makes sound. If a clip comes out silent or the Thai is poor, untick it and add the voice in CapCut (paste the .srt). Posting to TikTok and Shopee stays manual.

## Logs and debugging

- `pnpm demo` runs at `LOG_LEVEL=info` and writes everything to `.data/logs/api.log`, `worker.log` and `web.log` (appended, one JSON object per line, secrets and signed-URL queries already redacted). The terminal shows the same lines with a `[api]` or `[worker]` prefix, minus the two lines per request, which stay in the file.
- Follow one job: `grep <jobId> .data/logs/worker.log`. Events: `job.started`, `job.finished` (outcome, duration), `job.attempt_failed` (error code, will it retry), `provider.call` (one line per real provider call: model, duration, tokens, cost, anomaly flag) and `provider.call_failed` (code, retryable, kept as billed). The mock text writer makes no `provider.call` lines; only a saved real provider does.
- Follow a failed request: the error shown in the dashboard or panel carries a request id; `grep <requestId> .data/logs/api.log`.
- A failed job also shows its error code and message in the dashboard and the panel. The Meta AI, Flow and Shopee helpers have **Copy diagnostics**.

## Backup, restore and retention

**Back up** (before any risky change, and regularly):

```
export DATABASE_URL="$(bash scripts/pg-local.sh url)"
pnpm backup                              # the database in DATABASE_URL
pnpm backup -- --database creatorops_demo   # the database `pnpm demo` uses
```

It prints which database it dumped, and writes `.data/backups/<time>/` (a database dump, a copy of every media file, and a manifest with hashes). **Copy that folder off this computer**: a backup on the same disk does not survive the disk. **Keep `SECRETS_ENCRYPTION_KEY` somewhere safe and separate**: it is not in the backup, and without it the saved provider keys cannot be read (you would enter them again in Settings). Old backup folders are not deleted for you.

**Prove it works:** `pnpm backup:check` makes a backup, restores it into a scratch database and folder, checks the row counts, the migrations, every file's size and hash, and that `db:migrate` changes nothing, then removes the scratch copies. Run it after setting up and now and then; a backup is only trusted if this passes.

**Restore** (always into a new database and an empty folder, never over live data):

```
pnpm restore -- .data/backups/<time> --database my_restored_db --data-dir /path/to/new/media
```

It runs the same checks. Then start the API and the worker with `DATABASE_URL` pointing at `my_restored_db`, `DATA_DIR` set to the new folder, and the same `SECRETS_ENCRYPTION_KEY`. It needs the PostgreSQL client tools (`pg_dump`, `pg_restore`, at least as new as the server).

**Retention** runs by itself in the API process, once an hour. It removes audit events older than a year, failed or cancelled jobs older than 90 days (only if they have no cost records and no packages), expired package records 30 days after they expired, and finished upload records after 30 days. It never removes cost records or finished (succeeded) jobs. The periods can be longer (never shorter than the floors) with `AUDIT_RETENTION_DAYS`, `JOB_RETENTION_DAYS`, `EXPORT_ROW_RETENTION_DAYS` and `INTENT_RETENTION_DAYS` (see `.env.example`). The log line `retention.swept` shows what was removed.

## 3. Deployment

**What exists:** a single-machine setup for one user (above). `AUTH_MODE=mock` hands out tokens without credentials, so the API refuses to start with it in production and it must never face a network (`ALLOW_MOCK_AUTH_ON_NETWORK` exists for deliberate exceptions only).

**What does not exist yet:** hosted deployment. It needs three owner decisions first (D-022 and D-060): **Q-003** a real sign-in provider, **Q-004** an object-storage vendor (uploads and exports use the local `DATA_DIR`; the API and the worker must share it), **Q-007** a hosting target. Also before outside testers: a published extension id (Q-006) and pinned GitHub Actions (never run yet).

**When you are ready, the pieces are:** PostgreSQL 16 with the committed migrations (`infra/migrations`, applied by `apps/api/dist/db/cli.js`), Redis 7 (`REDIS_URL`), the API (`apps/api/dist/server.js`), the worker (`apps/api/dist/worker.js`), the dashboard's static build, and the extension built with `pnpm --filter @creatorops/extension build:store`. Variables are in `.env.example`: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (long random), `SECRETS_ENCRYPTION_KEY`, `API_BASE_URL`, `WEB_ORIGIN`, `EXTENSION_ORIGIN`, `DATA_DIR`, `NODE_ENV=production`, `TRUST_PROXY_HOPS` when behind a proxy. Do not publish until Q-003, Q-004 and Q-007 are answered.

## 4. Problems

| Symptom | Try |
|---|---|
| "Sign-in is not configured yet" in the panel | load the demo build (`pnpm demo` builds it), not a plain `pnpm build` |
| Settings says a key cannot be saved | set `SECRETS_ENCRYPTION_KEY` for the API and the worker, restart |
| "The final video needs ffmpeg" | install ffmpeg (above), restart the worker; the worker log says `ffmpeg found` at start |
| A job fails with "Paused: an earlier call cost much more than expected" | a call cost far more than your prices predict. Settings, Usage: check the prices and the plan, then press "I checked it, continue" (owner or admin) |
| Generation stays "Waiting to start" | the worker is not running or has no `REDIS_URL` |
| `ECONNREFUSED 5432` | PostgreSQL is down: `pnpm dev:db` |
| A helper says the page is not recognised | Copy diagnostics, send it; the fix is a small edit in `selectors.ts` / `sites.ts` |
| Shopee or Flow shows a check | finish it in that tab yourself; the helper does not solve it |
| `pnpm backup` says `pg_dump was not found` or is older than the server | install the PostgreSQL client tools, at least the server's version |
| Export download gives 404 | the API and the worker use different `DATA_DIR` folders |
