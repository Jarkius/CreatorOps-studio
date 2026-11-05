# Working Notes (handoff for the next session)

Read this first when resuming. It is a compact summary; the authoritative documents are listed in `docs/README.md`. Update it at the end of each session (keep it short).

**Last updated:** 2026-11-05 · **Branch:** `ccr-186e9c63-3y215n` (D-064; the old name in earlier docs is retired). **Phase:** 0 to 3 complete; S5.0 to S5.3 and A1 done; A2, A3 and A4 done (scene list, Meta AI helper on a fake page with wait-for-sign-in, Full Auto; the owner tests the real site); Phase 5 is complete: results and export in the dashboard and the side panel, file picker, name search (S5.4 to S5.9, D-074 to D-076); next is Phase 4 (real text).

## Where we are

| Phase | State |
|---|---|
| 0 Foundation (monorepo, CI, config, redaction, local Postgres) | done |
| 1 Extension shell + API foundation (mock auth, dashboard shell, MV3 side panel) | done |
| 2 Workspaces, products, media (API, dashboard, extension product view, uploads, signed media) | done; see the exit check in `docs/IMPLEMENTATION_STATUS.md` |
| 3 Content generation with a mock provider (jobs, Redis + BullMQ per D-006) | **in progress**: S3.0 to S3.8 done (see below); plan in D-045..D-061 |
| 4+ real providers, export, publishing | blocked on open questions Q-001, Q-002, Q-005 (see `docs/DECISIONS.md`) |

### Phase 3 progress (plan: D-045..D-054, details D-055/D-056, evidence in `docs/IMPLEMENTATION_STATUS.md`)

| Slice | State |
|---|---|
| S3.0 hardening (extension CSP, read-only-member harness, `.env.example`, CI format check) | done |
| S3.1 contracts + `provider-core` (templates, `MockTextProvider`, claim guard, output validation) | done |
| S3.2 schema + migration 0005 (`campaigns`, `content_drafts`, `jobs`) | done |
| S3.3 campaign API + templates list | done |
| S3.4 jobs API: idempotent create, cancel, caps, `JobQueue` interface (`NullJobQueue` default), transition table | done (commit 798206c) |
| S3.5 worker: claim, lease + heartbeat on DB time, retry (D-048), reconciler every 30 s, cancel handling, BullMQ adapter, `scripts/redis-local.sh`, `REDIS_URL`, CI `redis:7`; details in D-057 | done |
| S3.6 draft get, list, versioned PATCH, regenerate-section job with `SECTION_CHANGED` guard in the handler and again at settle; details in D-058 | done |
| S3.7a shared API client methods (templates, campaigns, drafts, jobs) | done |
| S3.7b campaigns UI: list, create, campaign page, Generate, job panel with polling and cancel, drafts list | done |
| S3.7c draft screen: sections, edit, regenerate, status, claim warnings, conflicts, copy; product-page "Create campaign" shortcut | done |
| S3.8 side panel: campaigns list, Generate, job status with polling and cancel, dashboard links; shared poll helpers in `packages/contracts`; details in D-061 | done (built by the orchestrator, live run done) |
| S5.0 follow-ups (D-064): `latestGenerateJob` on the campaign list, `campaignId`/`draftId` job filters, reopen and failed-job e2e | done |
| S5.1 contracts and S5.2 migration 0006 (`draft_assets`, `draft_exports`, `export_package` job type; D-067) | done |
| S5.3 draft attachments API (`PUT /drafts/:id/assets`, scene and AI label, migration 0007) | done |
| A1 side panel Create tab (product, mode, checklist, one button; starts campaign and generation) | done |
| S3.9 exit check: dashboard e2e now runs a real worker and Redis; campaign-to-draft spec (generate, edit, regenerate another section, reload) | done |

Tests at the last full run (S5 leftovers): contracts 77, provider-core 95, config 12, ui 43, extension unit 166, web 279, api 502; end-to-end 53 (22 extension, 31 dashboard). Lint, typecheck, build, format:check all pass.

Phase 3 gotchas: a section edit always beats a regenerate job (revision checked before the provider call and again under the draft row lock); editing content resets an approved draft to `draft`. Run the touched tests green before a mutation run (a red baseline makes every mutation look killed). the API entry is `apps/api/src/server.ts` (`index.ts` only exports a constant). Run Prettier from the repo root, not from `apps/api` (it reformats the OpenAPI snapshot there). BullMQ rejects `:` in a custom job id, so queue ids are `${jobId}_${attempt}`. Redis 7.0.15 is installed locally (`redis-server`). Mock Thai copy needs native review (Q-005). Constants are duplicated across schema, contracts and provider-core; `db/constants.test.ts` cross-checks them. The 500-campaign cap has no concurrent test. Migration mutation scripts must remove whole lines (a stray comma gives false positives). Regenerate the OpenAPI snapshot with `vitest run app.test -u` and check the diff only adds lines.

## How to run things

```
pnpm demo                                     # everything below in one command (API, worker, dashboard, mock sign-in); Ctrl+C stops
pnpm install
pnpm dev:db                                   # PostgreSQL 16 without Docker (scripts/pg-local.sh)
export DATABASE_URL="$(bash scripts/pg-local.sh url)"
pnpm db:migrate && pnpm db:seed               # dev database
pnpm dev:redis                                # Redis 7 without Docker (scripts/redis-local.sh); stop: pnpm dev:redis:stop
export REDIS_URL="$(bash scripts/redis-local.sh url)"   # needed by the worker and the queue tests
pnpm dev:worker                               # background worker (node apps/api/dist/worker.js); the API is apps/api/dist/server.js
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
pnpm e2e                                      # builds, then both suites, each on a fresh creatorops_e2e database
```

`pnpm typecheck` and `pnpm test` build first (packages consume each other's `dist`). Database tests fail loudly without `DATABASE_URL` (`SKIP_DB_TESTS=1` skips on purpose); the Redis queue tests do the same with `REDIS_URL` (`SKIP_REDIS_TESTS=1`).

## Working method (this project's rules)

- One vertical slice at a time: contract, backend and tests, UI, states, lint/typecheck/tests, docs and status (`docs/08_PHASE_PLAN.md`, skill `app-dev-methodology`, D-022).
- The skill `.claude/skills/app-dev-methodology` is the map of this method (what to read, the slice loop, what to update at the end). Keep it short and current: promote any lesson that recurs into it.
- Delegation (D-031): Haiku workers build mechanical slices from tightly written specs; the orchestrator verifies every slice by running the checks itself and writes the security-sensitive code; the Opus advisor reviews read-only at checkpoints (before each phase, and after each security-relevant phase).
- Worker specs start from `docs/WORKER_BRIEF_TEMPLATE.md` (mutation list, report format, do-not-add line); add each new failure to its lessons log.
- Mutation-check security rules: break the code on purpose and confirm a test fails. Verify the edit really applied (Prettier reflows code, so scripted string replacements silently miss).
- Commit only verified work. The stop hook asks for a commit whenever the tree is dirty: commit the verified subset and say what is left out.

## Gotchas learned the hard way

- Never rebuild `apps/api/dist` or shared packages while a worker is running E2E: the E2E server runs from `dist`. Workers run package-scoped commands only; the orchestrator runs the repo-wide ones.
- Vitest reports "Unhandled Errors" (exit code 1) even when every test passes. Treat it as a failure: it found a process-crashing upload bug.
- Drizzle wraps Postgres errors: look through `error.cause` for the code.
- `z.coerce` makes a schema's input type `unknown`; use the parsed (`z.infer`) type in services.
- The production-style `pg-local.sh` runs the server as user `pgdev` when invoked as root; the data parent `.data/` must stay root-owned.
- The 1x1 PNG some snippets use has a bad CRC; sharp rightly rejects it.
- Job rules (S3.5): every write names the status and the attempt it expects; test each ownership check from both the stale and the new owner's side. Test helpers must read shared counters before any `await`. Tests of table-wide scans (reconciler) empty the table first.
- Scripted edits: assert the old text exists, then `git diff` the file; a silent miss cost a wrong-file edit in S3.5. Lessons per slice are kept in the log at the bottom of `docs/WORKER_BRIEF_TEMPLATE.md`.
- Stopping a test server: `pkill -f dist/server.js` run from a command that contains that text kills your own shell (exit 144) and may stop nothing. Stop by PID (`ps -eo pid,args | grep dist/`, then `kill`), and drop a scratch database with `drop database ... with (force)` once the worker is stopped.
- Playwright cannot click the real extension toolbar or drive the side-panel UI; the panel page is loaded as a tab and the behaviour checked through `chrome.sidePanel.getPanelBehavior()`.
- A live run of the side panel needs a mock-auth build: `pnpm build` does not set it, and the panel then says "Sign-in is not configured yet". Use `cd apps/extension && VITE_AUTH_MODE=mock VITE_API_BASE_URL=http://localhost:3000 pnpm exec vite build`. Starting the API or worker needs `AUTH_MODE=mock`, `API_BASE_URL`, `WEB_ORIGIN`, `EXTENSION_ORIGIN` and a random `SESSION_SECRET` (keep it out of git).
- The extension e2e build goes to `apps/extension/dist-e2e` (it grants the meta.ai host at install; D-072) and the suite loads that folder, so `dist` stays the real mock-auth or release build. A seeded finished job needs an `output` (check constraint).
- Two elements can share one text in a row (the status pill and the status line both say "Cancelled"): scope e2e assertions to the row (`getByRole('listitem').filter({ hasText })`), or Playwright fails on a strict-mode violation.
- A rule inside a React hook (polling stop, key reuse) cannot be mutation-tested until it is a pure function or a test drives the hook; S3.8 needed a fake-timer test for the polling stop. Extract decisions into functions when they should be tested.

## Not verified / known gaps

- API and worker must share `DATA_DIR` (the e2e config now does); a worker with a different directory makes export downloads 404.

- Real toolbar click in Chrome; GitHub Actions has never run (including the e2e job and gitleaks).
- Visual layout and real screen readers (only automated axe checks).
- Extension does not show product images yet (the CSP already allows them since S3.0); current-page import deferred (D-019).
- Pin GitHub Actions to commit SHAs before the first release.

## Advisor findings to act on (2026-11-05, not yet fixed)

From the owner-test review; the Meta AI items are inference (no real meta.ai here), fix them after the owner's first run and diagnostics.
1. High: `metaai/page.ts` `stashMedia` fetches with `credentials:'include'`; a CDN answering `Access-Control-Allow-Origin: *` rejects that. Try `omit` first, then `include`, or read the bytes from the `<img>`.
2. High: prompts go as plain chat text; meta.ai may answer in text. Prefix "Imagine ", re-probe for a login modal after sending, and make the timeout message say what was seen. A logged-out page can still show a prompt box (`probePage` returns ready).
3. Medium: image pick takes `fresh[0]` of any image 256 px or wider; prefer the largest new image that is `complete` and stable.
4. Medium: `DATA_DIR` defaults to a relative path; API and worker started from different folders disagree. Resolve against the repo root or refuse a relative path; log the absolute path in both.
5. Medium: the worker's 30 s timeout covers every job type, including export and multi-variant real text. Use per-call and per-job-type timeouts (needed before Phase 4).
6. Medium: the export zip holds all media in memory (500 MB cap, worker concurrency 2). Lower the cap to about 100 MB until streaming.
7. Misleading: attaching files does not bump the draft version, so Results can show an old package as the latest; the idempotency hash is draft id and version only. Hash the attached asset ids and sha256 too and show "out of date".
8. Check in Chrome: `chrome.permissions.request` must run in the click handler before any `await`; closing the panel aborts a run; `window.open` after an async call may lose its user gesture.
9. Phase 4 plan and the reseller-gateway pricing advice: see D-077.

## Phase 4 state (2026-11-05)

S4.1 to S4.6 are built on a mock transport (D-077; details in IMPLEMENTATION_STATUS). To try it: set `SECRETS_ENCRYPTION_KEY` (`openssl rand -base64 32`) for the API and the worker, open Settings in the dashboard, save OpenRouter with a capped key and the prices, press Check connection, then generate. Send back the job error code and the Usage numbers if anything looks wrong. Next: S4.7 evaluation script (`pnpm eval:text`), S4.0 first real call with the owner's key, then the affiliate templates (D-078).

## Open questions that need the owner

Q-001 text provider, Q-002 image/video provider and spending cap, Q-005 Thai evaluation reviewers (before Phase 4); Q-003/Q-004/Q-007 hosting, auth provider and storage vendor (before any hosted deployment); Q-006 extension distribution (before a beta). Defaults are listed in `docs/DECISIONS.md`.

## Next steps

**Current plan (owner priority, 2026-11-04): the AutoGenX-style flow, then the rest.** Read D-068 (media generation is in the MVP), D-071 (the Meta AI helper) and D-066/D-069 (keys and providers) in `docs/DECISIONS.md`. D-014, D-069 item 1 and D-070 item 2 are superseded where they say "no browser automation".

1. **A2 (done 2026-11-04):** Scenes button on a finished campaign in the side panel: four scenes with editable prompts (local only), Copy, Reset, file status; client methods `drafts.listAssets` and `drafts.setAssets`. Gaps: no extension e2e (no worker in that suite), mock scene text order does not match the scene names (see `IMPLEMENTATION_STATUS.md`).
2. **A3 (done 2026-11-04, D-072):** Generate in Meta AI per scene in the side panel, built and e2e-tested against a fake meta.ai. **Owner action: test it on the real meta.ai** (load the demo build, press Generate in Meta AI on a scene, allow meta.ai in Chrome's prompt, stay signed in) and send the "Copy diagnostics" text if it fails; two fix rounds, then decide about AutoGenX. Fixes are usually in `sidepanel/metaai/selectors.ts`.
3. **A4 (done 2026-11-04, D-073):** Full Auto tick on the Create tab (script, then the four scene images in order, Cancel, skips scenes that have a file) and **Generate all scenes** in the scene list. Not built: video, fresh chat per scene, resume after the panel closes.
4. **A5 and all of Phase 5 (done 2026-11-05, D-074 to D-076):** zip builder, export job, list, signed download, sweeper, results and export in the dashboard and in the side panel, product file picker on the draft, name search in the library. Not built: a real SIGKILL of the worker (state it leaves is tested), an extension e2e for export.
5. **Next:** Phase 4 (real text: settings screen with the encrypted key D-066, OpenAI-compatible adapter, usage ledger, usage screen; OpenRouter is the default, D-065; spend cap is optional, D-069), the first real test S6.0, optional API adapters for images and video (Muse Image is offered at about $0.01 per image per OpenRouter's listing; unverified), asset filters (S5.4), reconciling the Phase 2 boxes in `docs/07`.
6. **Owner actions:** rotate the management token that was pasted in chat once; when ready, create an OpenRouter key (never in chat or git); test the helper on the real meta.ai after A3; check that Meta's paid plan is available in Thailand.
7. **Quick start for the owner:** `pnpm demo` (see README).

**Routine reminders**
- The dashboard e2e suite needs Redis and `REDIS_URL`: `pnpm dev:redis`, export `REDIS_URL`, then `pnpm e2e`.
- Services stop between sessions: start `pnpm dev:db` and `pnpm dev:redis` and re-export `DATABASE_URL` and `REDIS_URL` before running tests (an `ECONNREFUSED 5432` Unhandled Error means Postgres is down). A fresh container has no `node_modules`: run `pnpm install --frozen-lockfile`, then `pnpm build`.
- Scripted edits: assert exactly one match before replacing, and `git diff` the file. Prettier reflows code, so a scripted edit can silently miss (it happened again in A1).
- Verified for real so far: generate, regenerate-section, stale-revision and stale-version 409s (S3.6); retry bounded, reconciler recovery (S3.5); generate, edit and regenerate through the browser (S3.9); the Create tab against the real API (A1). Not exercised: a worker killed mid-job outside the unit tests; the real Chrome toolbar click; GitHub Actions has never run.
