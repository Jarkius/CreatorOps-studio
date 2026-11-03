# Implementation Status

Update this file at the end of every implementation session.

## Current phase
Phase 0 complete. Phase 1: S1.1 done and verified. Next: S1.2.

## Completed
- [x] Repository discovery (repository was empty; recorded 2026-11-03)
- [x] Architecture decisions (`docs/DECISIONS.md`, `docs/ARCHITECTURE.md`)
- [x] Project documents (`docs/01`–`08`, `README.md`, `CLAUDE.md`)
- [x] Project skill installed (`.claude/skills/app-dev-methodology`)
- [x] Monorepo scaffold and CI baseline (S0.1)
- [x] Config, logging with redaction, local database (S0.2)
- [x] API foundation, part 1: contracts, error shape, CORS, OpenAPI, rate limit (S1.1)
- [ ] API foundation, part 2: database schema, mock auth, workspace scope (S1.2)
- [ ] Dashboard shell (S1.3)
- [ ] Extension shell (S1.4)
- [ ] Workspace/products (S2.1–S2.4)
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
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check
node apps/api/dist/server.js                    # S0.2 startup check (needs the env vars in .env.example)
```

`pnpm typecheck` and `pnpm test` run `pnpm build` first, because packages consume each other's built output. Database tests need `DATABASE_URL`; without it they fail with instructions (set `SKIP_DB_TESTS=1` to skip them explicitly).

## Tests
Verified by the orchestrator (lint, typecheck, test, build, format:check all exit 0):
- S0.1: dependency rules proven with four throwaway violation files; all four fail lint.
- S0.2: `packages/config` 12 tests, `apps/api` 34 tests (redaction, logger, config, startup with a live PostgreSQL 16). Built `node apps/api/dist/server.js` checked in four scenarios: missing config exits 1 and names every variable; a short `SESSION_SECRET` exits 1 and the value is not printed; `AUTH_MODE=mock` with `NODE_ENV=production` is refused; a healthy database logs `db.connected` and exits 0.
- S1.1: `apps/api` 61 tests (27 for the app: health, request ids, error shape, validation, 413/415, rate limit, CORS, security headers, OpenAPI snapshot). Mutation-checked by the orchestrator: reflecting any CORS origin, leaking unexpected error messages, and trusting any caller request id each make tests fail.
Not verified locally: the GitHub Actions workflow (including the `postgres:16` service and the gitleaks job) has not run yet; Docker Compose is untested because no Docker daemon is available here.

## Tooling notes
- TypeScript 6.0.x, not 7: typescript-eslint 8.72.1 does not yet support 7. Revisit when it does.
- A small inline ESLint rule, `creatorops/no-restricted-relative-reach`, resolves relative imports because `no-restricted-imports` cannot see them.
- `build` emits tests into `dist/`; test scripts use `vitest run --dir src` so compiled copies do not run.
- `scripts/pg-local.sh` runs PostgreSQL as a non-root user (`pgdev`) when started as root; it trusts local unix-socket connections, so it is for development only. Its `url` command does not percent-encode special characters in `PG_LOCAL_PASSWORD`.
- Redaction (`apps/api/src/platform/redact.ts`) keeps numeric and boolean values under token-like keys so usage counters such as `inputTokens` stay readable.
- The startup check (`apps/api/src/startup.ts`) is a placeholder entry point; the HTTP server replaces it in S1.1.

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
S1.2 — Drizzle schema and migrations, mock auth, auth guard, workspace scope (`docs/08_PHASE_PLAN.md` §3).
