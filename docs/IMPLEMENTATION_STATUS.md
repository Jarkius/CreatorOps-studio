# Implementation Status

Update this file at the end of every implementation session.

## Current phase
Phase 0 and Phase 1 complete (S1.1–S1.5 done and verified; see the unverified list under Tests). Phase 2 complete (S2.1 to S2.8; see the exit check below). Next: Phase 3 (content generation with a mock provider). Consult the advisor on the Phase 3 slice breakdown first (docs/08 section 7).

## Completed
- [x] Repository discovery (repository was empty; recorded 2026-11-03)
- [x] Architecture decisions (`docs/DECISIONS.md`, `docs/ARCHITECTURE.md`)
- [x] Project documents (`docs/01`–`08`, `README.md`, `CLAUDE.md`)
- [x] Project skill installed (`.claude/skills/app-dev-methodology`)
- [x] Monorepo scaffold and CI baseline (S0.1)
- [x] Config, logging with redaction, local database (S0.2)
- [x] API foundation, part 1: contracts, error shape, CORS, OpenAPI, rate limit (S1.1)
- [x] API foundation, part 2: database schema, mock auth, workspace scope (S1.2)
- [x] Dashboard shell (S1.3)
- [x] Extension shell (S1.4)
- [x] Workspace/products (S2.1–S2.4)
- [x] Media upload/library (S2.5 to S2.7)
- [ ] Mock generation provider (Phase 3)
- [ ] Durable jobs (Phase 3)
- [ ] Real text provider (Phase 4)
- [ ] Export workflow (Phase 5)

## Current branch / commit
Branch `ccr-14958772-bzlatd`. Phases 0 to 2 and S3.0 are committed; see `git log` for the current commit.

## How to run
Node 22+, pnpm 10.28.0.

```
pnpm install
pnpm dev:db                                     # local PostgreSQL 16 without Docker (scripts/pg-local.sh), or: pnpm dev:db:compose
export DATABASE_URL="$(bash scripts/pg-local.sh url)"
pnpm db:migrate && pnpm db:seed                 # apply migrations, create the development user and workspace
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check
node apps/api/dist/server.js                    # start the API (needs the env vars in .env.example)
```

`pnpm typecheck` and `pnpm test` run `pnpm build` first, because packages consume each other's built output. Database tests need `DATABASE_URL`; without it they fail with instructions (set `SKIP_DB_TESTS=1` to skip them explicitly).

## Tests
Verified by the orchestrator (lint, typecheck, test, build, format:check all exit 0):
- S0.1: dependency rules proven with four throwaway violation files; all four fail lint.
- S0.2: `packages/config` 12 tests, `apps/api` 34 tests (redaction, logger, config, startup with a live PostgreSQL 16). Built `node apps/api/dist/server.js` checked in four scenarios: missing config exits 1 and names every variable; a short `SESSION_SECRET` exits 1 and the value is not printed; `AUTH_MODE=mock` with `NODE_ENV=production` is refused; a healthy database logs `db.connected` and exits 0.
- S1.1: `apps/api` 61 tests (27 for the app: health, request ids, error shape, validation, 413/415, rate limit, CORS, security headers, OpenAPI snapshot). Mutation-checked by the orchestrator: reflecting any CORS origin, leaking unexpected error messages, and trusting any caller request id each make tests fail.
- S1.2: `apps/api` 90 tests in 10 files (migrations, seed, signed tokens, auth guard on its own and through `/me`, workspace resolution, audit events in transactions, compile-time proof that an unchecked workspace id cannot reach a repository). Mutation-checked by the orchestrator: skipping the signature check, expiry, the guard's user lookup, a missing header, and the membership user condition each make tests fail. One mutation initially survived (the guard's user lookup was masked by `/me` re-checking); a guard-only test route now covers it.
- S1.3 (Haiku worker, verified by the orchestrator): `packages/ui` 18 tests, `apps/web` 7 tests, 4 Playwright tests (Overview, API-down error and retry, axe WCAG 2 A/AA with zero violations, skip link first).
- S1.4 (orchestrator): `apps/extension` 36 unit tests (manifest builder, built manifest and bundle secret scan, service worker, token store, session, panel) and 9 Playwright tests against the real built extension in headless Chromium: pinned id, runtime permissions, token only in `chrome.storage.session`, token reuse and one-time replacement, service-worker stop, API-down retry, narrow width. Mutation-checked: removing `setPanelBehavior` and writing the token to localStorage each fail E2E tests.
- S1.5 exit check against docs/06 Phase 1: dashboard loads (E2E); side panel loads and calls the same API (E2E, as a tab); service-worker restart (E2E); manifest permissions limited to `sidePanel`, `storage`, API origin (unit and E2E).
- Security review (Opus advisor, 10 findings) fixed: script privilege chain (D-035), request log fields (`req`/`res` serializers) and child-logger redaction, redaction gaps (paths after keys, error causes, Date/URL/Map/Set), mock-token host check and loopback refusal (D-032), proxy trust and 404 rate limiting (D-033), workspace-id brand lint rule and canonical id (D-034), token signature canonical encoding, client timeout through body read, template-database lock, CI permissions. Total tests now: api 114, extension 36, ui 18, contracts 13, config 12, web 7, provider-core 1, plus 13 E2E.
- S2.1: `apps/api` 135 tests (+21: workspace create/list/get with Thai NFC, strict bodies, per-user limit under concurrency, one-transaction audit, identical 404s; route policy; authorization harness that also proves it can fail). Mutation-checked: scope hook that lets non-members through, route policy that no longer requires the guard, and a non-strict body each fail tests. E2E (13) still pass. Advisor design review for Phase 2 recorded as D-037 to D-041.
- S2.2: `apps/api` 158 tests (+23: create/normalisation/validation, strict bodies, IDOR through both workspace paths and a stranger's cursor, identical 404s, versioned PATCH incl. 6-way race, archive/unarchive idempotence with one audit event, tied-timestamp pagination, roles, direct database constraints, audit transactionality); `packages/contracts` 27 tests. A test found a real bug (a price without currency returned 500 because Drizzle wraps the Postgres error); fixed. Mutation-checked: dropping the workspace filter, the version check, the role check, and the pagination tie-break each fail tests.
- S2.3 (Haiku worker, verified by the orchestrator): `packages/ui` 43 tests (Button, fields, ConfirmDialog, `active` pill), `apps/web` 35 tests, 8 new Playwright tests (create with Thai name, edit, validation, archive/restore through the dialog, conflict with "Load latest", empty workspace, axe on list/form/errors, keyboard).
- S2.4 (Haiku worker, verified by the orchestrator): `apps/extension` 48 tests and 5 new Playwright tests run for the first time by the orchestrator (product list, empty workspace, error and retry, 320px width, links in a new tab); extension E2E total 14.
- S2.5/S2.6 backend: `apps/api` 226 tests (asset suite of 43: image/video upload end to end, EXIF orientation, animated GIF, decompression bomb, corrupt image, type spoofing, SVG/HTML/script, size lies, wrong Content-Type, tampered/expired/replayed signed URLs, single use under concurrency, cross-user completion, quotas, cover-image rules, ranges, sweeping, purging, per-route rate limit). Mutation-checked: validator error listener, media signature without workspace, single-use claim, intent ownership, magic-byte check. Testing found a process-crashing bug (D-043).
- E2E total 26 (14 extension, 12 dashboard). Unit and integration total: api 226, extension 48, web 35, ui 43, contracts 27, config 12, provider-core 1.
- S2.7 (Haiku worker, verified by the orchestrator): `apps/web` 102 tests (62 new for uploads and the gallery, with a fake XHR), `packages/ui` 43, and 11 new Playwright tests (PNG and MP4 upload, Thai filename, preview, cover set and cleared on delete, server refusal of a fake PNG with retry/remove, client-side refusal of an oversized image and an SVG, axe, keyboard).
- End-to-end suites now run on their own database: `scripts/e2e-db.mjs` drops and recreates `creatorops_e2e`, migrates and seeds it before each suite, so runs never fill or depend on the development database (found when repeated runs hit the 20-workspace cap). Three consecutive full runs: 14 extension + 23 dashboard E2E tests pass each time.
- Totals: unit and integration 471 (api 238, web 102, extension 48, ui 43, contracts 27, config 12, provider-core 1); end-to-end 37.

## Phase 2 exit check (docs/07 and docs/06 Phase 2)
Exit criteria from docs/06: create a product in the dashboard and see it in the extension; upload and preview an image; unauthorized workspace access is rejected. All three are covered by passing automated tests (E2E: product created through the API appears in the panel; dashboard upload shows a loaded thumbnail and preview; IDOR tests and the authorization harness).

| docs/07 item | Evidence | Status |
|---|---|---|
| Create a workspace | `POST /workspaces` API tests (limit under concurrency, audit) | Done in the API and the dashboard (`/workspaces/new`, added after the exit check) |
| Create, edit, archive, view a product | API tests; dashboard E2E | Done |
| Required fields validated with clear messages | contracts, API and E2E tests | Done |
| Cannot reach another workspace's products by changing an id | IDOR tests (both URL shapes, cursors, bodies), harness over every route | Done |
| Product changes appear in dashboard and extension | both use the same API; extension E2E reads a product created through the API | Done |
| Upload accepts allowed formats and rejects unsupported or oversized files | 51 asset API tests; dashboard E2E (client-side and server-side refusal) | Done |
| MIME type and file signature validated | magic-byte tests, spoofing tests | Done |
| Upload progress and failure visible | failure: E2E; progress: unit tests with a fake XHR only | Done, progress not seen in a real browser |
| Preview, select primary image, delete | dashboard E2E | Done |
| Private asset URLs expire and are not guessable | signed URL tests (tampered, expired, swapped, replayed, deleted) | Done |
| Side panel opens through the extension action | `setPanelBehavior` checked via `getPanelBehavior()`; panel page loaded as a tab | **Not verified with a real toolbar click** |
| Extension has loading, empty, error states; survives service-worker suspension | extension E2E | Done |
| Current-page import is user-triggered and narrow | not implemented (a later slice, own decision, D-019) | Deferred |
| Extension shows product images | not implemented in the UI; the manifest CSP already allows images and media from the API origin (S3.0) | Deferred |
| Provider secrets server-side; all routes enforce workspace authorization; no prohibited features; publishing disabled | bundle scan; route policy and harness; no such code exists | Done |

Workspace-creation screen added after the exit check (route `/workspaces/new`, "New workspace" link, zero-workspace prompt on Overview and product pages; web unit 124, e2e 28 on a fresh DB; verified by the orchestrator). Known gaps carried forward: the asset library is not gated for a zero-workspace user; the zero-workspace state has unit tests only (no e2e); visual and screen-reader checks beyond axe; real toolbar-click check in Chrome; progress bars in a real browser.
Not verified locally: the GitHub Actions workflow (including the `postgres:16` service and the gitleaks job) has not run yet; Docker Compose is untested because no Docker daemon is available here.

## Tooling notes
- TypeScript 6.0.x, not 7: typescript-eslint 8.72.1 does not yet support 7. Revisit when it does.
- A small inline ESLint rule, `creatorops/no-restricted-relative-reach`, resolves relative imports because `no-restricted-imports` cannot see them.
- `build` emits tests into `dist/`; test scripts use `vitest run --dir src` so compiled copies do not run.
- `scripts/pg-local.sh` runs PostgreSQL as a non-root user (`pgdev`) when started as root; it trusts local unix-socket connections, so it is for development only. Its `url` command does not percent-encode special characters in `PG_LOCAL_PASSWORD`.
- Redaction (`apps/api/src/platform/redact.ts`) keeps numeric and boolean values under token-like keys so usage counters such as `inputTokens` stay readable.
- `apps/api/src/startup.ts` `prepare()` validates config and the database; `server.ts` then starts Fastify.
- Migrations are generated with `pnpm db:generate` into `infra/migrations` and committed; CI fails if generating produces any change. Schema comes only from these files.
- Mock auth: `POST /api/v1/auth/mock-token` (exists only when `AUTH_MODE=mock`, loopback only, Host-checked) issues an HMAC-signed 12-hour token for the seeded development user only. `GET /api/v1/me` needs it.
- Run both E2E suites with `pnpm e2e` (needs `DATABASE_URL` for the server and login, and Chromium; locally `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Each suite creates its own fresh `creatorops_e2e` database first, so no prior migration is needed. They run one after the other because both use port 3000.
- Not verified: clicking the real toolbar icon to open the side panel (Playwright cannot drive the side panel UI; the panel behaviour is checked through `chrome.sidePanel.getPanelBehavior()` and the panel page is loaded as a tab). The owner should load `apps/extension/dist` unpacked in Chrome once to confirm.
- Follow-ups: pin GitHub Actions to commit SHAs before the first release; the web E2E script uses POSIX env prefixes (not Windows-safe).

## Decisions made
- 2026-11-03: Final design accepted by owner delegation. See `docs/DECISIONS.md` (D-001 to D-031).
- 2026-11-03: Advisor review (D-025 to D-031) changed the plan: workspace resolution from the URL, database tests through `DATABASE_URL` only, signed media URLs, custom Vite extension build, CORS and OpenAPI in S1.1.
- 2026-11-03: `00_REFERENCE_PRODUCT_ANALYSIS.md` is background only; `01`–`07` win on conflict.

## Blockers / required user input
- None for Phases 1–3.
- Before Phase 4: Q-001 (text provider) and Q-005 (Thai evaluation).
- Before Phase 6: Q-002 (image/video provider and spending cap).
- Before any hosted deployment: Q-003, Q-004, Q-007.
- Before a beta: Q-006 (extension distribution).

## Next smallest task
Phase 3, slice 1. Before starting, have the advisor break Phase 3 down (content templates, the mock text provider, the job table and worker, Redis and BullMQ per D-006, idempotency, regenerate-one-section) and record the decisions.

## S3.0 Phase 2 cleanups (2026-11-04)
- Extension manifest CSP now has `default-src 'self'`, `form-action 'none'`, `img-src 'self' <api>`, `media-src <api>` (manifest test added; side panel e2e and screenshot confirm styling intact).
- Authorization harness gained a read-only-member pass: viewer and reviewer get 403 on every write route that takes a workspace id, and can still read. Mutation check: removing `assertCanWrite` from asset delete made the pass fail with "got 200"; restored.
- Asset library is gated by the zero-workspace prompt; `.env.example` lists every config variable; CI runs `format:check`; doc 04 routes corrected.
- Verified by the orchestrator: lint, typecheck, build, format, unit (api 240, web 124, extension 48, ui 43, contracts 27, config 12, provider-core 1) and both e2e suites (14 and 28) on a fresh database.

## S3.1 Contracts, TextProvider, mock, templates, claim guard (2026-11-04)
- `packages/contracts/src/content.ts`: section names, enums, limits, template, campaign, draft, job schemas, idempotency key rules; `IDEMPOTENCY_CONFLICT` (409) added to the error codes and mapped in the API.
- `packages/provider-core`: `TextProvider` interface, typed `ProviderError` (transient vs permanent), deterministic Thai-first `MockTextProvider` (fault markers live only in `mock.ts`), 3 code templates, grapheme-based output validation, claim guard (restricted and unsupported claims; never edits text).
- Verified by the orchestrator: lint, typecheck, build, format; unit tests contracts 60, provider-core 95, api 240, web 124, extension 48, ui 43, config 12. Mutation checks: dropping restricted-claim detection, never/always flagging unsupported claims, case-sensitive matching (survived at first; test added), allowing hashtags without `#`, dropping the 5xx fault all fail tests.
- Known: Thai mock copy is a draft and needs native-speaker review (Q-005); the shared provider contract suite lives in `mock.test.ts` and must move to a shared test file when a second adapter exists; the contracts and provider-core section limits are duplicated and must be kept equal (a cross-check test comes with S3.4).

## S3.2 Migration for campaigns, content_drafts, jobs (2026-11-04)
- Migration `0005_content_jobs` (generated, renamed, journal updated; `db:generate` shows no drift). Rules in D-055.
- Tests: 8 new constraint tests in `apps/api/src/db/migrations.test.ts` (cross-workspace links, draft in the campaign's own product, ranges, JSON shapes, idempotency per user, key and hash formats, job state rules, real lifecycle accepted, deletes refused).
- Mutation checks (orchestrator): removing each of 22 constraints one at a time made a test fail: jobs_campaign_fk, idempotency unique, lease, failed_has_error, target_matches_type, draft composite fk, campaign product fk, duration, variants, finished_consistent, output_only_when_succeeded, idempotency key format, request hash format, error_only_when_unsuccessful, attempts, sections object. (First attempt gave false positives from broken SQL; redone with whole-line removal.)

## S3.3 Campaign API (2026-11-04)
- Routes under `/api/v1/workspaces/:workspaceId`: `GET /templates`, `GET|POST /campaigns`, `GET|PATCH /campaigns/:campaignId` (archive is a status change; no delete). Product must be in the workspace and active, template must exist, language and duration default from the workspace and template, default name is cut on whole grapheme clusters (falls back to `Campaign`), 500-campaign cap enforced under a workspace row lock, versioned PATCH, audit events, write permission required (viewer and reviewer get 403).
- Built by a Haiku worker from the worker brief template; verified by the orchestrator: full chain, both e2e suites, the worker's mutation table (10 rules) with 5 re-run independently plus the new empty-name fallback; the authorization harnesses (stranger 404, read-only 403) now cover the new routes; OpenAPI snapshot regenerated (additions only).
- Known: cursor helpers are duplicated from products (extract before drafts and jobs add a third copy); the 500 cap has no concurrent-create test.
