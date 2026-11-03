# Implementation Status

Update this file at the end of every implementation session.

## Current phase
Phase 0 and Phase 1 complete (S1.1–S1.5 done and verified; see the unverified list under Tests). Phase 2: S2.1 done (workspace endpoints, authorization harness, route policy). Next: S2.2 (product API).

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
- [ ] Workspace/products (S2.1 done; S2.2–S2.4 next)
- [ ] Media upload/library (S2.5–S2.7)
- [ ] Mock generation provider (Phase 3)
- [ ] Durable jobs (Phase 3)
- [ ] Real text provider (Phase 4)
- [ ] Export workflow (Phase 5)

## Current branch / commit
Branch `ccr-14958772-bzlatd`. S0.2 committed on top of S0.1 and the documentation commits.

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
- Run both E2E suites with `pnpm e2e` (needs `DATABASE_URL`, a migrated database, and Chromium; locally `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). They run one after the other because both use port 3000.
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
S2.2 — product API, following D-037 and D-040. Extend the client in `packages/contracts` first (PATCH, bodies, conflict errors), then add the products migration and routes, then fixtures in the authorization harness.
