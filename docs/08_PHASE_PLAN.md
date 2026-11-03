# 08 — Phase 0–2 Plan and Working Method

**Status:** Accepted (owner delegation, 2026-11-03)
**Builds on:** `06_IMPLEMENTATION_ROADMAP.md` (phases), `07_ACCEPTANCE_TESTS.md` (test checklist), `DECISIONS.md` (choices).
**Method:** `.claude/skills/app-dev-methodology` applied as recorded in D-022.

This plan breaks Phases 0, 1, and 2 into the smallest slices that can each be built, tested, and reviewed on their own. Phases 3–8 stay as written in `06` and are planned in detail when reached.

---

## 1. Working method

**Hybrid:** Agile vertical slices with three Waterfall-style gates (D-022).

| Practice | Rule |
|---|---|
| Slice size | One slice is a day or two of work and ends in a green build. |
| Order inside a slice | Contract → backend and tests → UI → loading/empty/error states → lint, typecheck, tests → docs and `IMPLEMENTATION_STATUS.md`. |
| Work in progress | One slice at a time. |
| Gate A | Paid provider: terms, cost, budget cap approved (before Phase 4 and Phase 6). |
| Gate B | Publishing connector: official API access and compliance review recorded (before Phase 7). |
| Gate C | Release: `05` §7 and `07` checklists pass, CI green, README reproducible. |

**Definition of Ready (a slice may start when):** its contract and acceptance tests are written below, no decision it depends on is `OPEN`, and the previous slice is green.

**Definition of Done (a slice is finished when):**

1. Code compiles under strict TypeScript.
2. Lint, typecheck, and tests pass locally and in CI.
3. New behaviour has tests; authorization and workspace scoping are tested where relevant.
4. Every async UI has loading, empty, error, and retry states.
5. No secret is in source, logs, or a client bundle.
6. `docs/` and `IMPLEMENTATION_STATUS.md` are updated.
7. Nothing is presented as supported that has not been tested.

Failing tests are never skipped. Blockers and assumptions are reported in `IMPLEMENTATION_STATUS.md`.

---

## 2. Phase 0 — Foundation (no product features)

**Goal:** a project that builds, lints, tests, and runs in CI, with documented commands.
**Exit criteria (from `06`):** project builds; lint, typecheck, and test commands documented; no credentials committed.

### S0.1 — Monorepo scaffold and CI baseline

**Delivers:** pnpm workspace; `apps/{extension,web,api}` and `packages/{contracts,provider-core,ui,config}` as minimal buildable packages; shared strict `tsconfig`, ESLint, Prettier; Vitest; `.gitignore` (env files, `node_modules`, build output, data dir); `.env.example`; GitHub Actions running install, lint, typecheck, test, build.
**Acceptance tests:**
- Fresh clone then `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` succeeds.
- CI runs the same commands and passes.
- A placeholder test in each package runs.
- A secret-scanning step is present in CI.
- Dependency-rule lint fails when `apps/web` imports from `apps/api` (a deliberate failing fixture test proves the rule works).

### S0.2 — Config, logging, and local database

**Delivers:** `infra/docker/docker-compose.yml` with PostgreSQL; env schema helper in `packages/config` and fail-fast config in the API; structured logger with redaction.
**Acceptance tests:**
- `pnpm dev:db` starts PostgreSQL; the API connects.
- Starting the API with a missing or malformed variable exits with a readable error naming the variable.
- A unit test proves a log line containing `authorization`, `apiKey`, or a token field is redacted.

**Phase 0 done when:** S0.1 and S0.2 are done and `docs/IMPLEMENTATION_STATUS.md` has the real run commands.

---

## 3. Phase 1 — Extension shell and API foundation

**Goal (from `06`):** side panel opens, dashboard loads, both call the same API, and the extension survives service-worker restarts.

### S1.1 — Contracts, health endpoint, error shape

**Delivers:** `packages/contracts` with the error schema and health response; `GET /api/v1/health`; request id generation; central error mapping.
**Acceptance tests:**
- `GET /api/v1/health` returns `200` with a typed body.
- Any thrown error returns `{ error: { code, message, requestId } }` and no stack trace.
- An invalid request returns a validation error with field paths in `details`.
- The same `requestId` appears in the response header and in the log line.

### S1.2 — Database foundation and mock auth

**Delivers:** Drizzle setup; first migration (`users`, `workspaces`, `workspace_members`, `audit_events`) in `infra/migrations`; seed script; mock auth (`AUTH_MODE=mock`); auth guard; `RequestContext` with `workspaceId`; `GET /api/v1/me`.
**Acceptance tests:**
- Migration applies to an empty database and is the only way the schema is created.
- `GET /api/v1/me` without a token returns `401`; with the mock token returns the seeded user and workspace.
- The API refuses to start with `AUTH_MODE=mock` and `NODE_ENV=production`.
- A repository function called without `workspaceId` fails to compile (type test).
- Audit event is written in the same transaction as a state change (test with a forced rollback).

### S1.3 — Dashboard shell

**Delivers:** `apps/web` with routing, layout from `03` §1 (navigation entries present but disabled for later phases), typed API client, a home view showing the health and `me` results, shared state components in `packages/ui`.
**Acceptance tests:**
- Dashboard loads and shows the signed-in mock user.
- API down shows the shared error state with a working retry.
- Keyboard focus is visible on all controls; labels exist for all fields (axe check in the E2E run).
- Playwright test: dashboard loads against a running API.

### S1.4 — Extension shell

**Delivers:** `apps/extension` with an MV3 manifest, side panel opening from the extension action, a stateless service worker, a React side panel that calls `me` through the same client, original CreatorOps branding, an "Open dashboard" link.
**Acceptance tests:**
- Built manifest requests only `sidePanel`, `storage`, and the API host; a test fails on any other permission.
- Playwright with a persistent Chromium context loads the unpacked extension and the side panel shows the mock user.
- Killing the service worker and reopening the side panel still works (no state lost).
- API CORS accepts the configured extension origin and rejects others.
- Side panel renders at narrow width with no clipped content.
- No provider secret or token appears in the extension bundle (bundle scan test).

### S1.5 — Phase 1 exit check

**Delivers:** a short verification pass against `06` Phase 1 exit criteria and the relevant `07` Extension and Security items; `IMPLEMENTATION_STATUS.md` updated.
**Acceptance tests:** extension opens the side panel; dashboard loads; both call the same API; the service-worker restart test passes.

---

## 4. Phase 2 — Workspace, products, and media

**Goal (from `06`):** create a product in the dashboard and see it in the extension; upload and preview an image; unauthorized workspace access is rejected.

| Slice | Delivers | Key acceptance tests |
|---|---|---|
| S2.1 Workspace endpoints | `GET/POST /workspaces`, `GET /workspaces/:id` with settings fields from `04` | workspace created; second workspace's data invisible; foreign id returns `404` |
| S2.2 Product API | product table and migration; create, list (cursor), get, patch, archive | required-field validation messages; archived products hidden by default; `authorization` suite covers every product route; audit event on each change |
| S2.3 Product UI (dashboard) | list, create, edit, archive with loading/empty/error states | create then see in list; validation shown inline; Playwright create-and-edit flow |
| S2.4 Product view (extension) | selected product summary and list in the side panel | product created in the dashboard appears in the side panel after refresh |
| S2.5 Storage adapter | `StorageAdapter`, `LocalFsStorage`, key generation, signed short-lived read URLs | keys never contain user filenames; expired URL is rejected; foreign workspace cannot read another's file |
| S2.6 Upload API | upload-intent and complete-upload per `04`; size limit; MIME **and** signature check; thumbnail | spoofed MIME type rejected; oversize rejected; thumbnail created; asset row records source and sizes |
| S2.7 Asset UI | multi-file upload with progress, gallery, preview, primary image, delete with confirmation | failure and progress visible; primary image selection persists; delete requires confirmation |
| S2.8 Phase 2 exit check | run `07` Product, Media, and the product-related Extension items | all listed items pass |

Page import from the current tab (`activeTab`) is not in Phase 2. It gets its own slice and decision entry first (`DECISIONS.md` D-019).

---

## 5. Phases 3–8

Planned in detail when each begins. Entry conditions:

| Phase | Entry condition |
|---|---|
| 3 Content generation (mock) | Phase 2 exit check passed. Redis added in this phase (D-006). |
| 4 Real text provider | Gate A: Q-001 and Q-005 answered; budget cap approved. |
| 5 Asset library and export | Phase 3 done. |
| 6 Image/video provider | Gate A for image or video: Q-002 answered; spending cap approved. |
| 7 Publishing | Gate B. One platform at a time. |
| 8 Team and agency | Validated demand from the pilot (`00` §14.4). |

---

## 6. Traceability to acceptance tests

| `07` section | First covered in |
|---|---|
| Product and workspace | S2.1–S2.4 |
| Media | S2.5–S2.7 |
| Content generation | Phase 3 |
| Jobs | Phase 3 |
| Assets and export | Phase 5 |
| Extension | S1.4, S1.5, S2.4 |
| Security and compliance | every slice; formal pass at Gate C |

---

## 7. Risks and assumptions

| Risk or assumption | Mitigation |
|---|---|
| Playwright cannot drive extension side panels in a headless context | Try a persistent Chromium context with the extension loaded (headed or new headless mode); verify in S1.4 whether it works in CI. Fall back to loading the side-panel page as an ordinary tab and testing the manifest separately. |
| Extension origin changes between unpacked loads | Pin the extension id with a manifest `key` for development; real id is Q-006. |
| Mock auth leaks into production | Startup refusal plus a test (S1.2). |
| Scope creep into Phase 3 features during Phase 2 | One slice at a time; Definition of Ready requires written acceptance tests. |
| Thai text clipped in UI | Thai strings rendered at two sizes in component tests. |
| Provider cost surprises | Mock by default; Gate A before any paid call (D-009, D-016). |

## 8. What needs the owner

Nothing blocks Phases 0–3. The owner is needed for:

- The go-ahead to begin S0.1 (first code).
- Answers to Q-001 and Q-005 before Phase 4; Q-002 before Phase 6.
- Q-003, Q-004, and Q-007 before any hosted deployment.
- Q-006 before a beta.
