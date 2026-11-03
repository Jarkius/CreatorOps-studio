# CreatorOps Studio — Implementation Architecture

**Status:** Accepted (owner delegation, 2026-11-03)
**Relationship to other docs:** This document refines `02_SYSTEM_ARCHITECTURE.md`. It adds the concrete repository layout, module pattern, and conventions needed to build. Requirements live in `01`, UX in `03`, data and API contracts in `04`, security in `05`, phases in `06`, acceptance tests in `07`. Choices and their reasons live in `DECISIONS.md`. If this file conflicts with `01`–`07`, the numbered doc wins and this file is corrected.

---

## 1. Shape of the system

Extension-first UX, backend-first execution, one modular monolith.

```
┌────────────────────────┐      ┌────────────────────────┐
│ apps/extension         │      │ apps/web               │
│ Chrome MV3 side panel  │      │ Dashboard (React/Vite) │
│ thin client            │      │ full workspace         │
└───────────┬────────────┘      └───────────┬────────────┘
            └─────────────┬─────────────────┘
                          │ HTTPS, /api/v1, same contract
                 ┌────────▼─────────────────────────────┐
                 │ apps/api (Fastify, TypeScript)        │
                 │  ├─ http entry   (src/server.ts)      │
                 │  └─ worker entry (src/worker.ts)      │  ← Phase 3
                 └───┬─────────────┬───────────┬─────────┘
                     │             │           │
              ┌──────▼────┐ ┌──────▼─────┐ ┌───▼──────────────┐
              │PostgreSQL │ │Redis+BullMQ│ │ Object storage   │
              │ truth     │ │ Phase 3+   │ │ local disk first │
              └───────────┘ └────────────┘ └──────────────────┘
                     providers via packages/provider-core
                     (mock by default; real adapters from Phase 4)
```

Rules that hold across every phase:

1. The **database is the source of truth** for products, drafts, assets, jobs, and audit events. Redis holds queue messages only.
2. The **API owns all provider calls, secrets, storage access, and retries.** Neither client holds a provider key.
3. A **long-running job never depends on a client staying open.** The extension and dashboard only create jobs and read their status.
4. Both clients use the **same endpoints and the same authorization rules** (04 §7).
5. Every user-owned query is **scoped by workspace**.

---

## 2. Repository layout

```
creatorops-studio/
├── CLAUDE.md                  # instructions for Claude Code
├── README.md
├── .claude/skills/            # project skills (app-dev-methodology)
├── apps/
│   ├── extension/             # Chrome MV3 side panel (React + Vite)
│   ├── web/                   # dashboard (React + Vite)
│   └── api/                   # HTTP API + worker entry point
│       └── src/
│           ├── server.ts
│           ├── worker.ts                 # Phase 3
│           ├── modules/<name>/           # see §4
│           ├── storage/                  # StorageAdapter + local implementation
│           └── platform/                 # config, logging, errors, auth, db client
├── packages/
│   ├── contracts/             # Zod schemas, enums, API types, shared by all apps
│   ├── provider-core/         # provider interfaces, adapters, mock providers
│   ├── ui/                    # shared React primitives (state components, status pill)
│   └── config/                # tsconfig, eslint, prettier, env-schema helpers
├── infra/
│   ├── docker/                # docker-compose (PostgreSQL now, Redis in Phase 3)
│   └── migrations/            # SQL migrations (Drizzle output directory)
├── docs/
└── prompts/
```

Dependency rules, checked in lint:

| Package | May import |
|---|---|
| `apps/extension`, `apps/web` | `packages/contracts`, `packages/ui`, `packages/config` |
| `apps/api` | `packages/contracts`, `packages/provider-core`, `packages/config` |
| `packages/provider-core` | `packages/contracts` |
| `packages/ui` | `packages/contracts` (types only) |
| `packages/contracts` | nothing in this repo |

Neither client may import `apps/api` or `provider-core`. This keeps provider code and secrets out of browser bundles by construction.

---

## 3. API conventions

Full contract in `04_DATA_MODEL_AND_API.md`. The rules that shape code:

- Prefix `/api/v1`. JSON only. Cursor pagination on list endpoints.
- Error shape: `{ "error": { "code", "message", "requestId", "details?" } }`. Codes are stable strings (`PRODUCT_NOT_FOUND`, `JOB_NOT_CANCELLABLE`). Messages never include stack traces, provider response bodies, or secrets.
- Every create-job and create-export endpoint accepts `Idempotency-Key`. A unique constraint on `(workspace_id, idempotency_key)` returns the original resource for a repeat key.
- Enum values are lowercase snake case exactly as written in `04` (`in_review`, `generate_brief`).
- Every request has a `requestId` (generated or taken from `X-Request-Id`). It appears in logs and error bodies.
- Request and response schemas are defined once in `packages/contracts` and imported by API, web, and extension.

### Request context

```ts
type RequestContext = {
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "editor" | "reviewer" | "viewer";
  requestId: string;
};
```

Services receive the context explicitly. Repository functions require `workspaceId` as a parameter, so an unscoped query does not compile. Foreign-workspace ids return `404`, not `403`, so existence is not revealed.

**Where `workspaceId` comes from (D-025):** nested routes take it from the URL and check the caller's membership. Id-only routes look the resource up among the caller's member workspaces and take `workspaceId` from the found row. The client's claim is never trusted on its own.

---

## 4. Backend modules

Module names follow `02` §4. Each lives in `apps/api/src/modules/<name>/` with the same files:

```
routes.ts     HTTP mapping only
service.ts    business rules, state transitions, audit writes
repo.ts       Drizzle queries (workspace-scoped)
index.ts      the module's public surface; other modules import only this
```

| Module | Responsibility | Phase |
|---|---|---|
| `platform` (not a module) | config, logging with redaction, error mapping, db client, request context | 1 |
| `identity` | users, sessions, mock auth (dev only) | 1 |
| `workspace` | workspace settings and brand defaults | 2 |
| `products` | product facts, archive, primary image | 2 |
| `assets` | upload, metadata, thumbnails, signed read URLs | 2 |
| `content` | templates, campaigns, drafts, section regeneration, claim warnings | 3 |
| `jobs` | enqueue, status, cancel, bounded retry, idempotency | 3 |
| `providers` | registry and selection; calls adapters in `provider-core` | 3 |
| `usage` | usage events, budget caps | 4 |
| `exports` | ZIP package of media, caption, hashtags, checklist | 5 |
| `publishing` | capability flags, connectors | 7 (feature-gated) |
| `audit` | append-only events; written in the same transaction as the change | 2 |

Cross-cutting rules:

- A state change and its audit event commit in **one transaction**. Job enqueue happens after commit. A reconciler re-enqueues `queued` jobs older than a threshold.
- Modules call each other through `index.ts` only.
- No provider-specific code outside `provider-core` and the `providers` module.

---

## 5. Authentication

- **Phases 1–5:** development-only mock auth, isolated in `identity/mock`. It is enabled only when `AUTH_MODE=mock` and the process **refuses to start** if that flag is set while `NODE_ENV=production`. It issues a bearer token for one seeded user and workspace.
- **Extension auth in dev:** the side panel obtains the same mock bearer token from a token endpoint that exists only when `AUTH_MODE=mock` (D-027) and keeps it in `chrome.storage.session`, never `localStorage`. Tokens are HMAC-signed with `SESSION_SECRET`. Authentication is bearer-only with no cookies, so CSRF protection does not apply.
- **Production:** an external identity provider (OIDC) with short-lived sessions. The provider is an open question (`DECISIONS.md` Q-003) that must be closed before any hosted deployment. The extension would use `chrome.identity.launchWebAuthFlow`.
- Roles (`owner`, `admin`, `editor`, `reviewer`, `viewer`) exist in the schema from the first migration. Only `owner` is exercised until Phase 8.

---

## 6. Job pipeline (Phase 3)

States: `queued → running → succeeded | failed | cancelled` (04 `Job.status`).

- API validates the request, writes the `Job` row in the same transaction as the idempotency key, then enqueues the job id. The queue payload holds identifiers only.
- The worker loads authorized data, resolves provider configuration server-side, calls the adapter, stores the output, and updates the row.
- Progress is written to the job row. Clients poll `GET /jobs/:jobId`. Never display progress the provider has not reported (03 §3).
- Retries are bounded (default 3, exponential backoff) and apply only to transient error classes.
- Provider error classes are distinct: `timeout`, `rate_limited`, `quota_exceeded`, `invalid_input`, `policy_rejected`, `auth_failed`, `unavailable`, `unknown`. Only `timeout`, `rate_limited`, `unavailable` retry.
- Cancel is allowed in `queued` and `running`. A running job checks a cancel flag between provider calls.

Redis and BullMQ arrive with this phase. Before it there are no jobs.

---

## 7. Provider layer (`packages/provider-core`)

Interfaces follow `02` §6:

```ts
TextGenerationProvider.generateBrief(input)
ImageGenerationProvider.generateImage(input)
VideoGenerationProvider.generateVideo(input)
SpeechProvider.synthesize(input)            // later
```

Each adapter also declares `capabilities()` (supported features, limits, whether cost can be estimated) and maps its errors to the closed set in §6.

- **Mocks first.** `mock-text` returns deterministic Thai output from fixtures keyed by template version. `mock-image` and `mock-video` return placeholder files after a short delay. Mocks pass the same contract test suite as real adapters.
- A real adapter is added only after the gate in `06` Phase 4 (terms verified, key stored server-side, usage capture in place).
- No DOM scraping, browser automation of consumer AI sites, or undocumented endpoints.
- Each generation job records `provider`, `model`, template id and version, and the rendered prompt so results are reproducible.

---

## 8. Prompts and output contracts

- Templates are files under `apps/api/src/modules/content/prompts/<template>/v<N>/`: system prompt, user prompt, output schema.
- Product facts and imported text are passed as clearly delimited data, never as instructions (05 §3).
- Output must parse against the template's Zod schema. On failure: one repair attempt that includes the validation error, then the job fails with `output_invalid`. Unvalidated text is never saved into a draft.
- Claims in output must trace to supplied product facts or be added to `claimWarnings`.
- Thai is the default language. Language is stored on each campaign and draft.

---

## 9. Storage

```ts
interface StorageAdapter {
  put(key, bytes | stream, meta: { mimeType }): Promise<void>;
  getReadUrl(key, ttlSeconds): Promise<string>;   // short-lived, HMAC-signed (local and hosted, D-028)
  delete(key): Promise<void>;
  exists(key): Promise<boolean>;
}
```

- Phase 2: `LocalFsStorage` under `${DATA_DIR}/workspaces/<workspaceId>/`. Storage keys are generated server-side and never contain user filenames.
- Hosted: an S3-compatible adapter behind the same interface (open question Q-004).
- Uploads: size limits from config; MIME **and** file signature checked; thumbnails generated; original files never overwritten. Derived assets keep a lineage reference.
- Deleting a product archives it by default. Any cascade is explicit and confirmed (04 §7).

---

## 10. Web dashboard and shared UI

```
apps/web/src/
├── app/         routes, providers, layout shell
├── features/    products, assets, campaigns, drafts, jobs, exports, usage, settings
└── api/         typed client built from packages/contracts, TanStack Query hooks
```

- Server state in TanStack Query. Forms use React Hook Form with Zod schemas from `contracts`.
- `packages/ui` provides the shared state components every async view uses: loading, empty, error with retry, and the status pill. This enforces the interaction states in `03` §5 without per-screen copies.
- Navigation per `03` §1. Visual direction is an original dark navy/charcoal theme with a warm accent. Do not copy the reference product's layout, assets, or wording.
- Accessibility: keyboard navigation, visible focus, labels, and status never shown by colour alone.
- Thai text: use a font with Thai glyphs and a system fallback. UI tests render Thai strings at two sizes to catch clipped tone marks.

---

## 11. Chrome extension (`apps/extension`)

Thin client, per `03` §4 and `05` §4.

**Manifest (Phase 1):**

| Item | Value |
|---|---|
| `manifest_version` | 3 |
| `permissions` | `sidePanel`, `storage` |
| `host_permissions` | only the configured API origin |
| `activeTab` | added only with the page-import slice, with its own decision entry |
| content scripts | none until a documented feature needs one |
| `<all_urls>` | never |

A test reads the built manifest and fails if it requests anything outside this list.

**Behaviour:**

- Side panel is a React app that calls the same `/api/v1` endpoints as the dashboard.
- Development: MV3 pages cannot use the Vite dev server, so `pnpm --filter @creatorops/extension dev` runs `vite build --watch`; reload the unpacked extension after a change. `build:store` omits the development key (D-036).
- Build (D-029): custom Vite build with `sidepanel.html` and the service worker as entries and a small plugin generating `manifest.json` from a TypeScript object. A committed development key keeps the extension id stable.
- Testing: Playwright `launchPersistentContext` with `--load-extension`; read the extension id from the service worker; open `chrome-extension://<id>/sidepanel.html` as a tab (`sidePanel.open` needs a user gesture). Stop the service worker over CDP to test restarts. Extensions may not load in plain headless mode: fall back to headed mode under `xvfb-run`, then to loading the page as an ordinary tab with the manifest tested separately. Extension pages with host permissions bypass CORS, so CORS is proven with API tests that send an `Origin` header, not with E2E.
- The service worker only routes lightweight events (opening the panel). It holds no state; it can be killed at any time. Anything important lives on the backend.
- The API allows the extension's origin explicitly in CORS configuration. Wildcard origins are not used.
- No provider secrets, no long-running orchestration, no page reading in the background, no injection into TikTok, Meta, or commerce sites.
- Page import (Phase 2 or later) is user-initiated, shows what will be sent, and covers a narrow list of fields.

---

## 12. Configuration, secrets, logging

- Environment variables are parsed with a Zod schema (helper in `packages/config`). The API refuses to start on missing or malformed values.
- `.env.example` lists every variable with a comment. Real env files are git-ignored.
- Phase 1 variables: `DATABASE_URL`, `AUTH_MODE`, `API_BASE_URL`, `WEB_ORIGIN`, `EXTENSION_ORIGIN`, `SESSION_SECRET`. Phase 2 adds `DATA_DIR`. Phase 3 adds `REDIS_URL`.
- Provider keys are read only by the API/worker process, stored encrypted server-side when user-supplied, and never returned by any endpoint (endpoints return booleans such as "configured").
- Logs are structured JSON with `requestId`, `workspaceId`, and `jobId` where relevant. A redaction list covers `authorization`, `*apiKey*`, `*token*`, `*secret*`, `password`, and signed media URLs.

---

## 13. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | contracts, state machines, prompt rendering, claim rules, provider adapters |
| Contract | Vitest | every provider adapter (mock and real) against one shared suite |
| API integration | Vitest + Fastify inject + PostgreSQL | auth, workspace scoping, validation, idempotency, error shape |
| Queue integration (Phase 3) | Vitest + Redis | retry limits, cancel, re-enqueue after restart |
| Component | Vitest + Testing Library | loading, empty, error, retry states |
| End-to-end | Playwright (dashboard, and extension via a persistent Chromium context) | the flows in `07` |
| Extension manifest | Vitest | permission allow-list |
| Security | Vitest | an `authorization` suite iterates every route with a foreign workspace id and expects `404` |

CI runs lint, typecheck, unit and integration tests, and build on every push. E2E runs in CI once the dashboard exists.

**Database tests (D-026):** `DATABASE_URL` is the only contract. Vitest `globalSetup` applies the committed migrations to a template database; each test file clones it (`CREATE DATABASE … TEMPLATE …`) and drops the clone afterwards. Locally, `scripts/pg-local.sh` starts PostgreSQL as a non-root user; CI uses a `postgres:16` service container and a `drizzle-kit check` step.

---

## 14. Local development (planned in Phase 0)

These commands do not exist yet; they are the targets for slice S0.1–S0.2 in `08_PHASE_PLAN.md`:

```
pnpm install
pnpm dev:db        # start PostgreSQL: scripts/pg-local.sh, or docker compose
pnpm db:migrate
pnpm dev           # api + web (+ extension build watch)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

---

## 15. Out of architecture

By `05` §6 and `CLAUDE.md`, these have no module, route, or adapter:

- fake engagement, account warming, mass comments or messages
- device-farm or phone-rack control
- browser automation or scraping of consumer AI sites
- CAPTCHA, fingerprint, or proxy evasion
- undocumented platform endpoints
- scraping private content

A future request touching any of these goes back to the spec, not onto a branch.
