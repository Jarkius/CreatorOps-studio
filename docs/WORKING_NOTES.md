# Working Notes (handoff for the next session)

Read this first when resuming. It is a compact summary; the authoritative documents are listed in `docs/README.md`. Update it at the end of each session (keep it short).

**Last updated:** 2026-11-04 · **Branch:** `ccr-186e9c63-3y215n` (D-064; the old name in earlier docs is retired). **Phase:** 0 to 3 complete; S5.0 to S5.3 and A1 done; next is A2 (scene list with prompts), then A3 (Meta AI helper on a fake page), A4 (Full Auto), A5 (results and export).

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

Tests at the last full run (S5.0): contracts 75, provider-core 95, config 12, ui 43, extension unit 81, web 251, api 437; end-to-end 49 (19 extension, 30 dashboard). Lint, typecheck, build, format:check all pass.

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
- Playwright cannot click the real extension toolbar or drive the side-panel UI; the panel page is loaded as a tab and the behaviour checked through `chrome.sidePanel.getPanelBehavior()`.
- A live run of the side panel needs a mock-auth build: `pnpm build` does not set it, and the panel then says "Sign-in is not configured yet". Use `cd apps/extension && VITE_AUTH_MODE=mock VITE_API_BASE_URL=http://localhost:3000 pnpm exec vite build`. Starting the API or worker needs `AUTH_MODE=mock`, `API_BASE_URL`, `WEB_ORIGIN`, `EXTENSION_ORIGIN` and a random `SESSION_SECRET` (keep it out of git).
- Two elements can share one text in a row (the status pill and the status line both say "Cancelled"): scope e2e assertions to the row (`getByRole('listitem').filter({ hasText })`), or Playwright fails on a strict-mode violation.
- A rule inside a React hook (polling stop, key reuse) cannot be mutation-tested until it is a pure function or a test drives the hook; S3.8 needed a fake-timer test for the polling stop. Extract decisions into functions when they should be tested.

## Not verified / known gaps

- Real toolbar click in Chrome; GitHub Actions has never run (including the e2e job and gitleaks).
- Visual layout and real screen readers (only automated axe checks).
- Extension does not show product images yet (the CSP already allows them since S3.0); current-page import deferred (D-019).
- Pin GitHub Actions to commit SHAs before the first release.

## Open questions that need the owner

Q-001 text provider, Q-002 image/video provider and spending cap, Q-005 Thai evaluation reviewers (before Phase 4); Q-003/Q-004/Q-007 hosting, auth provider and storage vendor (before any hosted deployment); Q-006 extension distribution (before a beta). Defaults are listed in `docs/DECISIONS.md`.

## Next steps

0d. **Next build, in this order (the visible AutoGenX-style flow, owner priority):** A1 side-panel Create tab (product, mode tile, three-item checklist Script / Images / Video, one primary button) that starts a campaign and generation; A2 scene list with prompts and API client methods for attachments; A3 the Meta AI helper tested on a fake meta.ai page (e2e); A4 Full Auto runner (scenes in sequence, checklist and progress, Cancel, results saved as attachments so closing the panel loses nothing); A5 result list with thumbnails, copy caption, ZIP export. The owner tests on the real meta.ai after A3 and sends diagnostics; if it does not work after two fix rounds the owner may prefer to buy AutoGenX.
0c. **Meta AI helper (D-071, newest, owner decision):** the extension drives the owner's own logged-in meta.ai tab from the side panel, per scene, to generate and import images and videos; optional host permission for meta.ai only; built against a fake page, first real run done by the owner with the diagnostics button. Needs S5.3 first (attach media to scenes).
0b. **Media sourcing (D-070, newest):** the owner's Meta subscription is used through an assisted manual path (prompt pack with copy, open link, upload result per scene); no key or adapter needed; API adapters (OpenRouter images and video) come after. Order: S5.3 (scene label, migration 0007), S5.5, S6.5a scene screen, S5.6 to S5.9 export, then Phase 4 text, then adapters.
0a. **Providers (D-069):** one OpenRouter key for text, image and video; no Meta AI automation; spend cap optional. Next real step is S6.0, a small real test (3 scene images and 1 short clip from one product photo) once the owner sets the key; mock-first slices continue meanwhile.
0. **Scope change (D-068):** image and video generation are part of the MVP, built mock first like text. Order: S5.3 to S5.5 (attachments), then S6.1 to S6.8 (media pipeline, scene screen, export of generated media), with Phase 4 real text and the real media adapters plugging in after the owner enters keys.

0. **Phase 4 default provider is OpenRouter (D-065, 2026-11-04); MaxPlus is optional via the same adapter.** Earlier note: **Owner chose the Phase 4 provider (2026-11-04):** an OpenAI-compatible gateway (`maxplus-ai.cc`), 100-credit cap, owner reviews Thai output. Plan: D-062 and D-063; slices S4.0 (one real call to verify the gateway, needs the owner's key in `TEXT_PROVIDER_API_KEY`), S4.1 config and redaction, S4.2 adapter, S4.3 usage ledger and budget cap, S4.4 usage screen, S4.5 Thai evaluation. The gateway is development and pilot only, and its docs say no pool is open right now (D-062 item 2a). A management token was pasted in chat once; it is not stored anywhere and must be rotated by the owner. S4.0 needs a new `ccsk-` key capped at 100 credits. Phase 5 (export) is independent and can run first.
1. Phase 3 is done apart from the gaps listed under S3.9 in `docs/IMPLEMENTATION_STATUS.md` (screens reviewed in `docs/screenshots/` but the side panel not re-captured, GitHub Actions never run). Phase 4 (real text provider) needs the owner's answers to Q-001, Q-002 and Q-005 first. The D-061 job-window limit is fixed (D-064). Next is Phase 5 (export), which needs no provider; start with S5.1 after recording the Phase 5 decisions.
2. The dashboard e2e suite needs `REDIS_URL` and a running Redis: `pnpm dev:redis`, export `REDIS_URL`, then `pnpm e2e`.
3. Services stop between sessions: start `pnpm dev:db` and `pnpm dev:redis` and re-export `DATABASE_URL` and `REDIS_URL` before running tests (an `ECONNREFUSED 5432` Unhandled Error means Postgres is down, not a code failure). A fresh container also has no `node_modules`: run `pnpm install --frozen-lockfile`, then build `packages/ui` and `packages/contracts` before the extension's typecheck and tests.
4. Verified for real: generate, regenerate-section, stale-revision and stale-version 409s (S3.6); retry bounded, reconciler recovery after about 65 s (S3.5); generate, edit and regenerate through the browser (S3.9). Not yet exercised: a worker killed mid-job outside the unit tests.
