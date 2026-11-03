# CreatorOps Studio — Architecture

**Status:** Proposed (pending owner approval — see `DECISIONS.md`)
**Date:** 2026-11-03
**Source of product scope:** `PRODUCT_SPEC.md` (§6 architecture, §7 domain model, §8 provider contracts)

This document turns the spec into a concrete layout for the repository. It records how the pieces fit together and the rules each module must follow. Decision rationale lives in `DECISIONS.md`.

---

## 1. Shape of the system

A **modular monolith** with one API process, one worker process, one web app, and shared packages. Splitting into services is not planned.

```
┌──────────────────────────┐        ┌──────────────────────────┐
│ apps/web (React + Vite)  │ HTTP   │ apps/api (Fastify)       │
│ feature folders, TanStack│ ─────▶ │ routes → services → repo │
│ Query, RHF + Zod          │  JSON  │ Zod validation at edge   │
└──────────────────────────┘        └──────┬───────────┬───────┘
                                           │           │ enqueue
                                  Drizzle  │           ▼
                                           │   ┌──────────────────┐
                                           │   │ Redis + BullMQ    │
                                           │   └────────┬─────────┘
                                           ▼            ▼
                                 ┌──────────────┐  ┌──────────────────┐
                                 │ PostgreSQL   │◀─│ apps/worker       │
                                 │ source of    │  │ runs generation,  │
                                 │ truth        │  │ export jobs       │
                                 └──────────────┘  └────────┬─────────┘
                                                            │ adapters
                                                 ┌──────────▼─────────┐
                                                 │ packages/providers  │
                                                 │ text / image / video│
                                                 │ mock + real (later) │
                                                 └─────────────────────┘
                                 Local disk (media) behind StorageAdapter
```

Rules:

- The **database is the source of truth** for every job, draft, and asset state. Redis holds only queue messages; losing Redis must not lose user work.
- The **API never calls a provider directly** for long-running work. It writes a `GenerationJob` row and enqueues an id. The worker performs the call.
- The **web app never imports provider code** or receives provider keys. It sees capabilities from the API (for example, "image generation available: yes/no").

---

## 2. Repository layout

```
CreatorOps-studio/
├── apps/
│   ├── web/                 # React SPA (Vite)
│   ├── api/                 # Fastify HTTP API
│   └── worker/              # BullMQ consumer process
├── packages/
│   ├── domain/              # Zod schemas, enums, state machines, pure logic
│   ├── db/                  # Drizzle schema, migrations, repositories
│   ├── providers/           # Provider interfaces (spec §8), adapters, mocks
│   ├── prompts/             # Versioned prompt templates + output schemas
│   ├── storage/             # StorageAdapter interface + local implementation
│   └── config/              # Env parsing with Zod, shared tsconfig/eslint
├── docs/                    # PRODUCT_SPEC, ARCHITECTURE, DECISIONS, notes
├── docker-compose.yml       # PostgreSQL + Redis for local development
├── .env.example
└── README.md
```

Dependency direction (enforced by lint rule or review):

```
apps/* ──▶ packages/*
packages/domain ◀── everything else
packages/providers, packages/storage, packages/db depend on packages/domain only
apps/web depends on packages/domain (types/schemas only), never on db/providers/storage
```

---

## 3. Backend module design

Each domain module lives under `apps/api/src/modules/<name>/` with the same four files:

```
routes.ts      HTTP mapping only: parse input, call service, shape response
service.ts     business rules, state transitions, audit writes
repo.ts        Drizzle queries; every query takes workspaceId
schemas.ts     Zod input/output (re-exported from packages/domain)
```

Modules:

| Module | Responsibility | Phase |
|---|---|---|
| `auth` | Session for local single user; request context carries `workspaceId` | 1 |
| `products` | Product CRUD, primary image, restricted claims | 1 |
| `assets` | Upload, library listing, rename, tag, delete, lineage | 1 |
| `campaigns` | Campaign wizard state, content mode, options | 1 |
| `drafts` | ContentDraft and DraftAsset, versioning, approval status | 1 |
| `jobs` | GenerationJob lifecycle, retry, cancel, progress | 1 |
| `exports` | Build export package (zip + caption + checklist) | 1 |
| `generation` | Orchestrates text/image/video calls via providers | 1 (text), 2 (image/video) |
| `claims` | Restricted-claim and format checks | 2 |
| `publishing` | PublishingProvider interface, manual-only adapter | 2 (manual), 3 (APIs) |
| `audit` | Append AuditEvent; read for timeline view | 1 |

### 3.1 Request context

Every authenticated request resolves to:

```ts
type RequestContext = {
  userId: string;
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "APPROVER" | "VIEWER";
};
```

Services receive the context explicitly. Repositories require `workspaceId` as a parameter, so an unscoped query does not compile. This is the main defence for spec §7.2 and §17 criterion 8.

Phase 1 seeds one user and one workspace with role `OWNER`. The role checks are present but only the `OWNER` path is exercised. Adding real users later changes the auth provider, not the data model.

### 3.2 Errors and responses

- Typed errors: `AppError { code, message, status, details? }`. Codes are stable strings such as `PRODUCT_NOT_FOUND`, `JOB_NOT_CANCELLABLE`, `CLAIM_BLOCKED`.
- Responses use one envelope for errors (RFC 9457 problem-details shape) and plain JSON for success.
- Validation errors list field paths from Zod.
- No stack traces or provider error bodies reach the client. Those go to structured logs with secrets redacted.

### 3.3 Transactions and audit

- A state change and its `AuditEvent` row are written in **one transaction**.
- Job enqueue happens **after** the commit. If enqueue fails, a reconciler re-enqueues jobs in `QUEUED` state older than a threshold. This avoids the classic "job in queue, row rolled back" problem.

### 3.4 Idempotency

- Creating a job, draft, or export accepts an optional `Idempotency-Key` header.
- Unique constraint: `(workspace_id, idempotency_key)` on the target table.
- A repeated key returns the original resource, not a duplicate.
- Publishing (Phase 3) follows the same rule and additionally requires `userConfirmedAt` (spec §8.4).

---

## 4. Job pipeline

### 4.1 Job states

```
QUEUED ──▶ RUNNING ──▶ SUCCEEDED
   │          │
   │          ├──▶ FAILED ──(retry, attempts < max)──▶ QUEUED
   │          │
   └──────────┴──▶ CANCELLED
```

- `attempts` increments on each start. `max` default is 3 with exponential backoff (2s, 8s, 30s).
- Cancel is allowed in `QUEUED` and `RUNNING`. A running job checks a cancel flag between provider calls and stops; provider work already billed is recorded.
- Only the worker transitions `QUEUED → RUNNING → SUCCEEDED/FAILED`. The API can only request `CANCELLED` or re-queue a `FAILED` job.

### 4.2 Progress and polling

- The worker writes `progress` (0–100) and `updated_at` to the job row at meaningful steps.
- The web app polls `GET /jobs?campaignId=…` every 2 seconds while any job is active, then backs off. No WebSockets in Phase 1.
- Page refresh restores state from the database. Nothing depends on in-memory client state.

### 4.3 Worker

- One entry point per queue. Concurrency per provider is configured in `packages/config`, so a slow provider does not starve text generation.
- Worker writes provider usage (tokens or units, estimated cost) to `input_json`/a usage field for the unit-economics worksheet (spec §14.3).

---

## 5. Provider layer

### 5.1 Interfaces

Use the interfaces from spec §8 unchanged for `TextGenerationProvider`, `ImageGenerationProvider`, `VideoGenerationProvider`, and `PublishingProvider`. Add two rules:

1. **Every adapter returns a typed result.** Failures map to a closed set of codes: `RATE_LIMITED`, `AUTH_FAILED`, `CONTENT_BLOCKED`, `INVALID_INPUT`, `PROVIDER_UNAVAILABLE`, `UNKNOWN`. The job retry policy depends on these codes.
2. **Capabilities are declared, not guessed.** Each adapter exposes `capabilities()` with supported aspect ratios, max duration, and whether reference images are accepted.

### 5.2 Registry

```ts
// packages/providers/src/registry.ts
registerText("mock-text", mockText);
registerText("<real-text-id>", realText);   // added after Phase 0 decision
```

Business code asks the registry by id. The id is stored on each `GenerationJob` (`provider` column), so an old draft can always be traced to the exact adapter that produced it.

### 5.3 Mock providers

- `mock-text`: deterministic output from fixtures keyed by template version. Used in all Phase 1 tests.
- `mock-image`, `mock-video`: return local placeholder files after a short delay. Used to test queue progress and asset lineage.
- Mocks run the same contract tests as real adapters.

### 5.4 What adapters must not do

- No DOM scraping, browser automation, or session hijacking of consumer AI websites (spec §4.1C, §4.4).
- No provider keys in logs, error messages, or responses.

---

## 6. Prompt and output contracts

- Prompts live in `packages/prompts/<template-id>/v<N>/` as files: `system.md`, `user.md.hbs`, `output.schema.ts`.
- Every generated record stores `template_id`, `template_version`, and the rendered prompt hash. The full prompt text is stored with the job for reproducibility (spec §7.2).
- Model output must parse against the template's Zod schema. On failure: one repair attempt with the validation error, then `FAILED` with code `OUTPUT_INVALID`. Never save unvalidated text into a draft.
- Thai is the default output language. Language is a per-campaign setting and is stored on every draft.

Initial templates for Phase 1:

| Template | Output |
|---|---|
| `angles.v1` | 3 content angles: title, hook, rationale |
| `script.v1` | Hook, scene list, voiceover, CTA for one angle |
| `caption.v1` | Caption and hashtags, length-limited |
| `shotlist.v1` | Scene-by-scene shots with image/video prompt text |

---

## 7. Storage

### 7.1 StorageAdapter

```ts
interface StorageAdapter {
  put(key: string, bytes: Uint8Array | Readable, meta: { mimeType: string }): Promise<void>;
  getReadUrl(key: string, ttlSeconds: number): Promise<string>;   // signed in hosted mode
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

- Phase 1: `LocalFsStorage` writes under `${DATA_DIR}/workspaces/<workspaceId>/...`. Keys never contain user-supplied filenames.
- Phase 4: `S3Storage` (R2 or S3) with the same interface.
- Original uploads are never overwritten. Generated and edited variants get new keys and a `parent_asset_id` for lineage.

### 7.2 Upload rules

- Maximum size per type set in config (for example, image 15 MB, video 200 MB in Phase 2).
- MIME type is checked by sniffing the first bytes, not the client header.
- Images are re-encoded to a thumbnail and read for width/height. EXIF is stripped from the derived copy.
- Filename is stored as display text only.

### 7.3 Deletion

- Deleting an asset marks it `ARCHIVED` and removes the files after the retention window (config, default 30 days). Hard delete is available immediately through an explicit action with confirmation.
- Deleting a product cascades to its assets in the same way.

---

## 8. Frontend architecture

### 8.1 Structure

```
apps/web/src/
├── app/            routing, providers, layout shell
├── features/
│   ├── products/   list, detail, form
│   ├── assets/     library grid, inspector
│   ├── campaigns/  wizard steps
│   ├── drafts/     review cards, editor
│   ├── jobs/       progress list, retry/cancel
│   └── exports/    export dialog
├── shared/         UI primitives, status pill, empty/error states, i18n
└── api/            generated client from OpenAPI, TanStack Query hooks
```

Rules:

- Server state only in TanStack Query. Zustand is not needed in Phase 1; keep it for later if a real client-state need appears.
- Forms use React Hook Form with Zod resolvers from `packages/domain`, so the same rules run in browser and server.
- No provider names, model ids, or keys in components. Components receive capability flags and display labels.

### 8.2 Layout (from spec §5.1)

- Left nav: Products, Campaigns, Assets, Exports, Settings (Dashboard added in Phase 2; Calendar and Publishing in Phase 2–3).
- Main canvas: current list or editor.
- Right inspector: selected asset or draft details. Collapses to a drawer below tablet width.
- Phone width: single column, nav becomes a bottom bar. Review is usable on a phone; editing is fine on desktop.

### 8.3 Core screens (Phase 1)

1. **Products list:** cards with primary image, name, status. Empty state links to "New product."
2. **Product editor:** facts, selling points, restricted claims, brand voice, reference images with one marked primary.
3. **Campaign wizard:** Product → Mode → Options (language, tone, audience, aspect ratio, variant count) → Generate. Progress steps show which are done.
4. **Campaign review:** three angle cards. Each expands into script, captions, and shot list. Each section has edit, regenerate, and approve controls.
5. **Asset library:** grid with multi-select, filter by product, type, status. Inspector shows prompt, provider, lineage.
6. **Export:** choose drafts and assets, download zip containing media, `caption.txt`, `hashtags.txt`, and `checklist.md`.

### 8.4 Interaction rules

- Every list, grid, and job view has loading, empty, error, and retry states. These are shared components, not per-screen copies.
- Regenerating one section changes only that section. The previous version is kept, and the user can revert.
- Status vocabulary is shared across features: `DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED`, plus job states. Colour and label come from one map.
- Destructive actions use an explicit confirm dialog naming the object.
- Thai text uses a font with Thai glyphs and system fallback. Layout must not clip Thai (tone marks above lines), so tests render Thai strings at two font sizes.

### 8.5 Design principles

- **Review before anything leaves the app.** Export and (later) publishing require a visible preview and a confirmation step.
- **Show provenance.** Every asset shows where it came from: upload, generated by which provider, from which prompt version.
- **Show uncertainty.** Claims that the checker cannot verify are flagged in place, not hidden in a log.
- **Plain language.** Labels describe the action ("Create 3 angles"), not the mechanism ("Invoke text pipeline").

---

## 9. Chrome extension (deferred)

Not built in Phase 1–2. When it is scheduled, design it as a thin client:

- Side panel shows: current campaign, job progress, recent assets, "Open in workspace."
- Import only after an explicit click, with a preview of what will be sent.
- Permissions: `sidePanel`, `storage`, and `activeTab` only if needed. No `<all_urls>`, no background page reading.
- Auth via the same API tokens as the web app. Tokens are not stored in `localStorage`; use `chrome.storage.session` where possible.

---

## 10. Configuration and secrets

- All env vars are declared in `packages/config` with a Zod schema. The API and worker refuse to start if required values are missing or malformed.
- `.env.example` lists every variable with a comment. Real `.env` files are git-ignored.
- Provider keys are read only by the worker (and by the API only for capability checks, returning booleans).
- Phase 1 secrets: `DATABASE_URL`, `REDIS_URL`, `DATA_DIR`, `SESSION_SECRET`. No provider keys required because Phase 1 uses mocks.
- Logging: `pino` with a redaction list covering `authorization`, `*apiKey*`, `*token*`, `*secret*`, `password`.

---

## 11. Testing strategy

| Layer | Tool | What it covers |
|---|---|---|
| Domain unit | Vitest | state machines, validators, prompt rendering, claim rules |
| Contract | Vitest | every provider adapter (mock and real) against the same suite |
| DB integration | Vitest + Postgres in Docker | migrations, repository scoping, idempotency constraints |
| Queue integration | Vitest + Redis in Docker | retry, cancel, re-enqueue after crash |
| API | Vitest + Fastify inject | auth, scoping, validation errors |
| UI component | Vitest + Testing Library | loading, empty, error, retry states |
| End-to-end | Playwright | product → campaign → review → export |
| Security | Vitest | cross-workspace access denied on every route; publish blocked without confirmation |

A test suite named `authorization` iterates over every registered route and asserts a foreign-workspace id returns 404, not 403 (to avoid confirming existence).

---

## 12. Observability

- Structured JSON logs with `requestId`, `workspaceId`, `jobId` where relevant.
- Metrics (Phase 2): job durations, failure codes, queue depth, provider latency.
- Error reporting: Sentry or equivalent, opt-in, with the same redaction list. Off by default in local mode.
- Usage ledger: every provider call writes a row (provider, operation, units, estimated cost, job id) so cost per accepted asset can be computed (spec §14.3).

---

## 13. Local development

- `docker compose up -d` starts PostgreSQL and Redis.
- `pnpm install`, `pnpm db:migrate`, `pnpm dev` starts web, API, and worker.
- `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint` are the four required checks; CI runs all four.
- Seed command creates one workspace, one user, and one sample product with three placeholder images.

---

## 14. Explicitly out of architecture

These are excluded by spec §4.4 and §12. They have no module, route, or adapter:

- Engagement automation (views, likes, follows, comments)
- Device farm or phone controller
- Browser automation of consumer AI sites
- CAPTCHA, fingerprint, or proxy evasion
- Scraping private platform content

If a future request touches any of these, it goes back to the spec, not into a branch.

---

## 15. Open architecture questions

Tracked in `DECISIONS.md` with status `OPEN`:

1. Real text provider and its terms (Phase 0)
2. Real image and video providers, if any, and their cost model (Phase 0/2)
3. Hosted auth provider (Phase 4)
4. Object storage vendor: Cloudflare R2 or AWS S3 (Phase 4)
5. Whether to add a Thai-specific copy evaluation set before Phase 2 (spec §16)
