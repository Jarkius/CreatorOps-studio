# Working Notes (handoff for the next session)

Read this first when resuming. It is a compact summary; the authoritative documents are listed in `docs/README.md`. Update it at the end of each session (keep it short).

**Last updated:** 2026-11-04 · **Branch:** `ccr-14958772-bzlatd` · **Phase:** 2 complete; Phase 3 in progress (S3.0 to S3.5 done, next S3.6).

## Where we are

| Phase | State |
|---|---|
| 0 Foundation (monorepo, CI, config, redaction, local Postgres) | done |
| 1 Extension shell + API foundation (mock auth, dashboard shell, MV3 side panel) | done |
| 2 Workspaces, products, media (API, dashboard, extension product view, uploads, signed media) | done; see the exit check in `docs/IMPLEMENTATION_STATUS.md` |
| 3 Content generation with a mock provider (jobs, Redis + BullMQ per D-006) | **in progress**: S3.0 to S3.5 done (see below); plan in D-045..D-056 |
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
| **S3.6** draft get + versioned PATCH, regenerate-section job (`SECTION_CHANGED` guard; the worker already fails that job type with `INTERNAL` until its handler exists, see `process.ts`) | **next** |
| S3.7 dashboard UI (Haiku worker) | todo |
| S3.8 extension generate action + job status (Haiku worker) | todo |
| S3.9 exit check against docs/06 Phase 3 and docs/07 | todo |

Tests at the last full run (after S3.5): contracts 60, provider-core 95, config 12, ui 43, extension 48, web 124, api 384; end-to-end 42 (14 extension, 28 dashboard). Lint, typecheck, build, format:check all pass.

Phase 3 gotchas: the API entry is `apps/api/src/server.ts` (`index.ts` only exports a constant). Run Prettier from the repo root, not from `apps/api` (it reformats the OpenAPI snapshot there). BullMQ rejects `:` in a custom job id, so queue ids are `${jobId}_${attempt}`. Redis 7.0.15 is installed locally (`redis-server`). Mock Thai copy needs native review (Q-005). Constants are duplicated across schema, contracts and provider-core; `db/constants.test.ts` cross-checks them. The 500-campaign cap has no concurrent test. Migration mutation scripts must remove whole lines (a stray comma gives false positives). Regenerate the OpenAPI snapshot with `vitest run app.test -u` and check the diff only adds lines.

## How to run things

```
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
- Playwright cannot click the real extension toolbar or drive the side-panel UI; the panel page is loaded as a tab and the behaviour checked through `chrome.sidePanel.getPanelBehavior()`.

## Not verified / known gaps

- Real toolbar click in Chrome; GitHub Actions has never run (including the e2e job and gitleaks).
- Visual layout and real screen readers (only automated axe checks).
- Extension does not show product images yet (the CSP already allows them since S3.0); current-page import deferred (D-019).
- Pin GitHub Actions to commit SHAs before the first release.

## Open questions that need the owner

Q-001 text provider, Q-002 image/video provider and spending cap, Q-005 Thai evaluation reviewers (before Phase 4); Q-003/Q-004/Q-007 hosting, auth provider and storage vendor (before any hosted deployment); Q-006 extension distribution (before a beta). Defaults are listed in `docs/DECISIONS.md`.

## Next steps

1. Workspace-creation screen: done and verified. Asset library now gated.
2. Phase 3 plan is recorded as D-045 to D-054 (advisor reviewed). S3.0 to S3.5 are done; next is S3.6 (draft get and list, versioned PATCH, regenerate-section job with its worker handler; orchestrator writes the job part), then S3.7 and S3.8 (Haiku workers), then the S3.9 exit check.
3. Verified for real in S3.5: API + worker + Redis created drafts from an HTTP request; a transient failure retried 3 times and failed with a stable code; a job whose Redis message was wiped was recovered by the reconciler after about 65 s. Not yet exercised: a worker killed mid-job outside the unit tests.
