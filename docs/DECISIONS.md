# CreatorOps Studio — Decision Log

**Last updated:** 2026-11-03

Status values:

- `ACCEPTED`: approved; implement as written.
- `OPEN`: question that must be answered before the related work begins.
- `DEFERRED`: intentionally postponed; revisit at the listed phase.
- `SUPERSEDED`: replaced by a later decision; kept for history.

On 2026-11-03 the owner delegated final design decisions ("review and make decisions for final design"). Entries marked *accepted by delegation* were chosen from the recommendations made in that session and can be reopened by the owner at any time. Change a decision by adding a new entry that supersedes the old one.

## Document precedence

1. `CLAUDE.md` compliance boundaries and `05_SECURITY_AND_COMPLIANCE.md` never yield to anything else.
2. `01`–`04`, `06`, `07` are the requirements and contracts.
3. `ARCHITECTURE.md` refines `02` and is corrected if it conflicts.
4. This log records choices where the documents allowed options.
5. `00_REFERENCE_PRODUCT_ANALYSIS.md` is background research only. Where it differs from `01`–`07` (enum casing, phase numbering, role names, extension timing), `01`–`07` win.

---

## Summary

| ID | Decision | Status |
|---|---|---|
| D-001 | Modular monolith; API app also hosts the worker entry point | ACCEPTED |
| D-002 | pnpm workspaces; layout from the build pack; no Turborepo at first | ACCEPTED |
| D-003 | Fastify for the API | ACCEPTED |
| D-004 | Drizzle ORM; migrations in `infra/migrations` | ACCEPTED |
| D-005 | PostgreSQL from Phase 1; access only through `DATABASE_URL` (see D-026) | ACCEPTED |
| D-006 | Redis + BullMQ introduced in Phase 3; DB is source of truth | ACCEPTED |
| D-007 | React + Vite + Tailwind + TanStack Query + React Hook Form + Zod | ACCEPTED |
| D-008 | Local filesystem storage behind a StorageAdapter | ACCEPTED |
| D-009 | Provider adapters with mocks; no real provider before the Phase 4 gate | ACCEPTED |
| D-010 | Manual export only until Phase 7; publishing feature-gated | ACCEPTED |
| D-011 | Dev-only mock auth through Phase 5; production auth provider open | ACCEPTED |
| D-012 | Chrome extension deferred until after Phase 2 | SUPERSEDED by D-019 |
| D-013 | Phone-farm and device-control features excluded | ACCEPTED |
| D-014 | No browser automation of consumer AI websites | ACCEPTED |
| D-015 | Thai is the default content language | ACCEPTED |
| D-016 | No billing; usage events and budget caps from Phase 4 | ACCEPTED |
| D-017 | Git: commits when asked; no pull request unless requested (branch name superseded by D-064) | ACCEPTED |
| D-018 | Greenfield repository; scaffolding starts at Phase 0 on owner go-ahead | ACCEPTED |
| D-019 | Extension-first UX with a thin extension shell in Phase 1 | ACCEPTED |
| D-020 | Phase numbering follows `06` (Phases 0–8) | ACCEPTED |
| D-021 | API conventions from `04` (prefix, error shape, pagination, enums, idempotency) | ACCEPTED |
| D-022 | Hybrid methodology: Agile vertical slices with documentation and approval gates | ACCEPTED |
| D-023 | Project skill `app-dev-methodology` installed at `.claude/skills/` | ACCEPTED |
| D-024 | Local-first through Phase 5; hosted deployment decided later | ACCEPTED |
| D-025 | Workspace resolved from the URL plus a membership check | ACCEPTED |
| D-026 | Database tests: `DATABASE_URL` contract, template databases, no Docker needed | ACCEPTED |
| D-027 | Bearer-only auth (no cookies); mock token endpoint exists only in mock mode | ACCEPTED |
| D-028 | All media read URLs are HMAC-signed, locally and hosted | ACCEPTED |
| D-029 | Extension built with a small custom Vite build, not CRXJS | ACCEPTED |
| D-030 | CORS allow-list, OpenAPI generation, and baseline rate limit in S1.1 | ACCEPTED |
| D-031 | Delegation model: Haiku workers, Opus advisor at checkpoints | ACCEPTED |
| D-032 | Mock auth is loopback-only and checks the Host header | ACCEPTED |
| D-033 | Proxy trust is explicit; unknown routes are rate-limited | ACCEPTED |
| D-034 | The workspace-id brand can be minted only by the identity service (lint-enforced) | ACCEPTED |
| D-035 | Local database: authenticated sockets, private socket directory, root-owned parent | ACCEPTED |
| D-036 | Extension development key: public half committed; store builds omit it | ACCEPTED |
| D-037 | Phase 2 data model: composite foreign keys, versions, numeric prices | ACCEPTED |
| D-038 | Uploads: signed single-use intents, streamed PUT, magic-byte allowlist, quotas | ACCEPTED |
| D-039 | Media reads: HMAC-signed URLs, content type from the database | ACCEPTED |
| D-040 | API refinements: strict bodies, archive as POST, versioned PATCH, cursor pagination | ACCEPTED |
| D-041 | Secure-by-default routes: guard and scope enforced at startup | ACCEPTED |
| D-042 | Product routes are nested under the workspace | ACCEPTED |
| D-043 | Upload hardening found in testing: early error listener, configurable per-route limit | ACCEPTED |
| D-044 | Phase 2 security review fixes: quota, purge, completion and sweep races, timeouts | ACCEPTED |
| D-045 | Phase 3 execution model: DB row is the truth, BullMQ carries only a job id, leases, reconciler | ACCEPTED |
| D-046 | Phase 3 routes nested under the workspace; job types | ACCEPTED |
| D-047 | Idempotency-Key required on job-creating POSTs | ACCEPTED |
| D-048 | Retry policy: pure function, 3 attempts, transient only | ACCEPTED |
| D-049 | Templates in code, id and version pinned per job | ACCEPTED |
| D-050 | Draft sections, per-section revision, regenerate guard | ACCEPTED |
| D-051 | Claim guard on every provider output | ACCEPTED |
| D-052 | TextProvider interface and deterministic Thai-first mock | ACCEPTED |
| D-053 | Polling with backoff; per-workspace active-job and rate caps | ACCEPTED |
| D-054 | Local Redis without Docker; Redis tests gated on REDIS_URL | ACCEPTED |
| D-055 | S3.2 schema: campaigns, content_drafts, jobs and their database-level rules | ACCEPTED |
| D-056 | S3.4 job creation, cancellation and queue hand-off details | ACCEPTED |
| D-057 | S3.5 worker: claim, lease, settle, retry, reconcile, BullMQ adapter | ACCEPTED |
| D-058 | S3.6 drafts: get, list, versioned PATCH, regenerate-section job | ACCEPTED |
| D-059 | S3.7 and S3.8 UI direction from market research (`docs/UI_RESEARCH.md`) | ACCEPTED |
| D-060 | Publishing plan: assisted posting first, official APIs next; no UI-automation posting | ACCEPTED |
| D-061 | S3.8 side panel: campaigns, generate and job status from the API | ACCEPTED |
| D-062 | Phase 4 text provider: OpenAI-compatible adapter, MaxPlus gateway for development and pilot only | ACCEPTED (owner choice 2026-11-04) |
| D-063 | Phase 4 spend control: 100 credits, enforced in the app and on the key, fail closed | ACCEPTED |
| D-065 | Phase 4 default provider: OpenRouter through the same OpenAI-compatible adapter; MaxPlus stays an optional config | ACCEPTED (advisor recommendation, owner suggested OpenRouter 2026-11-04) |
| D-064 | S5.0 (Phase 3 follow-ups): latest generate job on the campaign list, job filters, branch rule, acceptance-tick rule | ACCEPTED |
| Q-001 | Real text generation provider | ANSWERED in part (D-062); production vendor still open |
| Q-002 | Real image and video providers and cost model | OPEN (gate for Phase 6) |
| Q-003 | Production auth provider | OPEN (before any hosted deployment) |
| Q-004 | Object storage vendor | OPEN (before any hosted deployment) |
| Q-005 | Thai copy evaluation set and reviewers | ANSWERED in part (D-063): the owner reviews; evaluation set drafted in S4.5 |
| Q-006 | Extension distribution (Chrome Web Store) and extension id | OPEN (before beta) |
| Q-007 | Production hosting target | OPEN (before any hosted deployment) |

---

## D-001 — Modular monolith with a worker entry point
**Status:** ACCEPTED (accepted by delegation; refines the earlier "separate worker app" idea)
**Context:** `02` §1 and `CLAUDE.md` require a modular monolith and avoid premature microservices. The pack's layout lists workers inside `apps/api`.
**Decision:** One `apps/api` package with two entry points, `server.ts` (HTTP) and `worker.ts` (Phase 3), sharing modules. They run as separate processes.
**Consequences:** One codebase and one image. Workers scale separately in production. A split into separate packages stays possible if module boundaries hold.

## D-002 — pnpm workspaces and the pack's layout
**Status:** ACCEPTED (accepted by delegation)
**Context:** The earlier proposal used `apps/{web,api,worker}` and `packages/{domain,db,providers,prompts,storage,config}`. The pack specifies `apps/{extension,web,api}`, `packages/{contracts,provider-core,ui,config}`, and `infra/`.
**Decision:** Use the pack's layout (`ARCHITECTURE.md` §2). Database code, storage adapter, and prompt templates live inside `apps/api`. Turborepo is not added until build times justify it.
**Consequences:** Fewer packages to maintain. Dependency rules in `ARCHITECTURE.md` §2 keep browser bundles free of provider code.

## D-003 — Fastify
**Status:** ACCEPTED (accepted by delegation)
**Context:** `02` §3 says Fastify, or NestJS if the repo already uses it. The repo is empty.
**Decision:** Fastify with Zod validation at the boundary and OpenAPI generated from the contracts.

## D-004 — Drizzle ORM
**Status:** ACCEPTED (accepted by delegation)
**Context:** `02` §3 requires one of Drizzle or Prisma, not both.
**Decision:** Drizzle with `drizzle-kit`. Migration SQL is written to `infra/migrations` and committed. No implicit schema creation in any environment (`CLAUDE.md`).

## D-005 — PostgreSQL from Phase 1
**Status:** ACCEPTED
**Context:** `06` Phase 1 includes Docker Compose for PostgreSQL.
**Decision:** PostgreSQL for development, tests, and production. No SQLite path. The application and tests reach it only through `DATABASE_URL`; the Compose file is a convenience, not a requirement (D-026).

## D-006 — Redis and BullMQ in Phase 3
**Status:** ACCEPTED (accepted by delegation; changes the earlier "Phase 1" timing)
**Context:** `README.md` says Redis and BullMQ arrive when asynchronous workers are introduced. `06` introduces the job table and worker in Phase 3.
**Decision:** No Redis before Phase 3. BullMQ carries job ids only. `Job` rows hold state, and a reconciler re-enqueues stale `queued` rows.
**Consequences:** Phases 1–2 need only PostgreSQL. Losing Redis later delays work but loses none.

## D-007 — Frontend stack
**Status:** ACCEPTED
**Decision:** React, Vite, Tailwind, TanStack Query, React Hook Form, and Zod for the dashboard and the extension side panel. Zustand only if a real client-state need appears.

## D-008 — Storage behind an adapter
**Status:** ACCEPTED
**Decision:** `StorageAdapter` interface with `LocalFsStorage` in Phase 2. Keys are generated server-side. Originals are immutable. Read URLs are short-lived (`07` Media).

## D-009 — Provider adapters and mocks
**Status:** ACCEPTED
**Context:** `CLAUDE.md`: mock providers so development needs no paid credentials. `06` Phase 4 gates the first real provider.
**Decision:** Interfaces and mocks first. A real adapter needs verified terms, server-side key storage, and usage capture. All adapters pass one contract suite.

## D-010 — Manual export; publishing gated
**Status:** ACCEPTED
**Decision:** Export ZIP in Phase 5. Publishing connectors, if any, arrive in Phase 7 behind feature flags, one platform at a time, only after official API access is confirmed. No platform is shown as connected without a recorded sandbox test.

## D-011 — Mock auth for development only
**Status:** ACCEPTED (accepted by delegation)
**Context:** `06` Phase 1 calls for mock auth isolated from production. `02` §3 says use a secure session/OIDC provider rather than custom password auth.
**Decision:** `AUTH_MODE=mock` for Phases 1–5. The API refuses to start with mock auth in production. The production provider is Q-003. Workspace scoping applies to every route from its first version.

## D-012 — Extension deferred (superseded)
**Status:** SUPERSEDED by D-019
**Note:** Recorded 2026-11-03 earlier in the session. The build pack makes the side panel a Phase 1 deliverable.

## D-013 — Device-control features excluded
**Status:** ACCEPTED
**Context:** `05` §6 and `CLAUDE.md` prohibit warm-up, engagement automation, and evasion. The reference stream shows a phone rack; its purpose is unverified (`REFERENCE_OBSERVATIONS.md`).
**Decision:** No ADB, device orchestration, or multi-device code. A desktop companion appears only in Phase 8 and only with a validated user need and a written policy review.

## D-014 — No browser automation of consumer AI sites
**Status:** ACCEPTED
**Decision:** Generation uses provider APIs, mocks, or user-led manual import. No DOM scraping, session reuse, or undocumented endpoints.

## D-015 — Thai-first
**Status:** ACCEPTED
**Decision:** Campaign language defaults to Thai. English optional. Language is stored per campaign and draft. UI tests render Thai at two font sizes.

## D-016 — No billing before validation
**Status:** ACCEPTED
**Decision:** No billing, credits, or plans before a paid pilot. Usage events and per-workspace budget caps arrive in Phase 4 so pricing can be decided from real data. No "unlimited generation" promises (`06` cost discipline).

## D-017 — Git policy
**Status:** ACCEPTED
**Decision:** Work on the designated branch (the name was `ccr-14958772-bzlatd`; see D-064). Commit and push when the owner asks (a stop-hook request counts). No pull request unless explicitly requested.

## D-018 — Greenfield
**Status:** ACCEPTED
**Context:** The repository was empty locally and on the remote at the start of the session.
**Decision:** Scaffold from scratch in Phase 0 slice S0.1 once the owner says go. Documents come first; no application code exists yet.

## D-019 — Extension-first with a thin shell in Phase 1
**Status:** ACCEPTED (accepted by delegation; supersedes D-012)
**Context:** `02` and `03` make the side panel the quick-entry surface; `06` Phase 1 requires an MV3 side panel and a dashboard calling the same API.
**Decision:** Phase 1 delivers the extension shell: side panel opens, calls the API, survives service-worker restarts. Permissions are limited to `sidePanel`, `storage`, and the API origin. Page import (`activeTab`) is a later slice with its own decision. The extension holds no state and no secrets.
**Consequences:** The extension is tested from Phase 1 (manifest allow-list test, restart test). Product screens reach the extension in Phase 2.

## D-020 — Phase numbering
**Status:** ACCEPTED
**Decision:** Phases 0–8 as in `06`. The earlier four-phase numbering is retired.

## D-021 — API conventions
**Status:** ACCEPTED (accepted by delegation; replaces the earlier RFC 9457 idea)
**Decision:** `/api/v1`; cursor pagination; `{ error: { code, message, requestId, details? } }`; lowercase enum values from `04`; `Idempotency-Key` on job and export creation; reviewer role is `reviewer` (not `APPROVER`).

## D-022 — Methodology
**Status:** ACCEPTED (accepted by delegation)
**Context:** The `app-dev-methodology` skill contrasts Agile (uncertain requirements, rapid iteration) with Waterfall (regulated, fixed scope, sequential documentation). This project has an uncertain product direction and a compliance-sensitive publishing area.
**Decision:** Agile vertical slices (Kanban-style, one slice at a time) with Waterfall-style gates at three points:
1. Before a paid provider: terms, cost, and budget cap approved.
2. Before any publishing connector: official API access and compliance review recorded.
3. Before release: the checklists in `05` §7 and `07` pass.
Every slice follows the order in `CLAUDE.md`: contract, backend and tests, UI, states, lint/typecheck/tests, docs and status update.

## D-023 — Project skill
**Status:** ACCEPTED
**Decision:** The owner's `app-dev-methodology` skill is installed unchanged at `.claude/skills/app-dev-methodology/SKILL.md`. It is a generic planning guide. Project-specific rules stay in `CLAUDE.md` and these docs, which take precedence where they differ.

## D-024 — Local-first
**Status:** ACCEPTED
**Decision:** Phases 1–5 target local development and a single-user alpha. Hosted deployment choices (Q-003, Q-004, Q-007) are made before any hosted release.

---

## D-025 — Workspace resolution
**Status:** ACCEPTED (advisor review, 2026-11-03)
**Context:** `04` §4 mixes workspace-nested routes (`/workspaces/:workspaceId/products`) with id-only routes (`/products/:productId`). A single `RequestContext.workspaceId` does not say where it comes from.
**Decision:** For nested routes the workspace comes from the URL and the caller's membership is checked. For id-only routes the service looks the resource up among the caller's member workspaces and sets `workspaceId` from the found row. A resource outside the caller's workspaces returns `404`. The client never supplies a workspace id that is trusted without a membership check.

## D-026 — Database test and local setup
**Status:** ACCEPTED (advisor review)
**Context:** The Docker daemon may be unavailable (it is in the current build sandbox). `initdb` refuses to run as root.
**Decision:** `DATABASE_URL` is the only contract. `scripts/pg-local.sh` starts a local PostgreSQL as a non-root user for development without Docker. Test `globalSetup` applies the committed migrations to a template database; each test file creates `CREATE DATABASE t_<pid>_<n> TEMPLATE creatorops_tpl` and drops it afterwards. CI uses a `postgres:16` service container and runs `drizzle-kit check` to prove the schema comes only from committed migrations.

## D-027 — Bearer-only auth and mock token endpoint
**Status:** ACCEPTED (advisor review)
**Decision:** Authentication uses bearer tokens only and no cookies, so CSRF protection (`05` §2) does not apply; this is recorded so it is not re-litigated. In `AUTH_MODE=mock` the API exposes a token-issuing endpoint that does not exist in any other mode. Tokens are HMAC-signed with `SESSION_SECRET`.

## D-028 — Signed media URLs everywhere
**Status:** ACCEPTED (advisor review)
**Context:** `<img>` tags cannot send a bearer header, and `07` requires expiring private URLs.
**Decision:** The local storage adapter issues HMAC-signed, expiring read URLs, the same as hosted storage. Logging redacts the whole query string of media URLs.

## D-029 — Extension build
**Status:** ACCEPTED (advisor review)
**Decision:** A small custom Vite build: `sidepanel.html` as an HTML entry, the service worker as an ES-module entry, and a short plugin that writes `manifest.json` from a TypeScript object. CRXJS is not used (version coupling and HMR quirks are a debugging risk). A development manifest `key` is generated in S1.4 and only its public part is committed so the extension id, and therefore `EXTENSION_ORIGIN`, stays stable.

## D-030 — CORS, OpenAPI, rate limit
**Status:** ACCEPTED (advisor review)
**Decision:** In S1.1: CORS with an explicit allow-list of `WEB_ORIGIN` and `EXTENSION_ORIGIN` (no wildcard); OpenAPI generated from the Zod contracts with a snapshot test; a baseline global rate limit. Per-generation limits come in Phase 3.

## D-031 — Delegation model
**Status:** ACCEPTED (owner request, 2026-11-03)
**Decision:** The orchestrating model verifies every slice by running lint, typecheck, and tests itself. Cheap Haiku workers implement mechanical slices from tightly written specs. The orchestrator writes or tightly reviews security-sensitive code: redaction, error mapping, auth guard and request context, workspace scoping, CORS, the extension manifest and build, the authorization test harness, storage and signed URLs, upload validation, and the database test helper. An Opus advisor is consulted read-only at checkpoints (before each phase and when a design question arises), not for routine implementation.

## D-032 — Mock auth is loopback-only and Host-checked
**Status:** ACCEPTED (security review, 2026-11-03)
**Context:** The mock-token endpoint issues a token without credentials. With `HOST=0.0.0.0`, or through DNS rebinding (a page whose name resolves to 127.0.0.1 is treated as same-origin, so CORS does not apply), another party could obtain one.
**Decision:** The API refuses to start with mock auth on a non-loopback `HOST` unless `ALLOW_MOCK_AUTH_ON_NETWORK=true` is set deliberately. The mock-token endpoint also rejects any request whose `Host` header is not the host of `API_BASE_URL` (loopback spellings of the same port are treated as equal).

## D-033 — Proxy trust and 404 rate limiting
**Status:** ACCEPTED (security review)
**Decision:** `TRUST_PROXY_HOPS` (default 0) sets how many reverse-proxy hops are trusted for the client address. With 0, `X-Forwarded-For` is ignored so a client cannot spoof its address; set it to the real number of proxies in production. Unknown routes pass through the rate limiter too.

## D-034 — Workspace-id brand is lint-enforced
**Status:** ACCEPTED (security review)
**Context:** `brandWorkspaceId` is exported so the identity service and tests can create a `WorkspaceId`, which means any module could mint one from an unchecked request value.
**Decision:** An ESLint rule forbids importing `brandWorkspaceId` anywhere in `apps/api` except `identity/service.ts` and tests. The service brands the id returned by the database, not the caller's spelling.

## D-035 — Local database hardening
**Status:** ACCEPTED (security review)
**Context:** The first `scripts/pg-local.sh` trusted local socket connections, used a shared `/tmp` socket, and chowned a log file inside a directory the server user owned. Together these let a local user run commands as the server user and trick root into changing ownership of another file.
**Decision:** Local connections require the password; the socket lives in a private 0700 directory; the data parent directory stays owned by the invoking user so the server user cannot replace files that root later touches; root refuses symlinked paths and unsafe parents.

## D-036 — Extension development key
**Status:** ACCEPTED
**Decision:** `apps/extension/dev-extension-key.json` holds only the public key and the id it yields (`emahncamejoabipafmjjfbnkdllmhcnm`). Development and test builds include it so `EXTENSION_ORIGIN` is stable. `pnpm --filter @creatorops/extension build:store` builds without it. `*.pem` is git-ignored. The production extension id is Q-006.

## D-037 — Phase 2 data model
**Status:** ACCEPTED (advisor design review, 2026-11-03)
**Decision:**
- `products` and `assets` each carry `unique(workspace_id, id)`, and cross-table references use composite foreign keys `(workspace_id, x_id)`, so the database itself refuses an asset linked to another workspace's product or a primary image from another workspace.
- `products.primary_asset_id` references `assets(workspace_id, id)` (migration 0003, `ON DELETE NO ACTION`: a hard delete of an asset that is still a cover is refused). Deleting an asset is a soft delete (`status`, `deleted_at`) and clears the product's cover in the same transaction; the purge clears any stale cover before removing a row. Setting a cover locks the asset (`FOR SHARE`) in the update transaction so a concurrent delete cannot slip in.
- Products carry `version int` (optimistic concurrency), `status` (`active`/`archived`) and `archived_at`. Price is `numeric(12,2)` with a 3-letter currency, both null or both set; never a float.
- `selling_points` and `restricted_claims` are `jsonb` arrays checked with `jsonb_typeof = 'array'`; Zod limits each to 20 strings of 1 to 300 characters.
- Text columns have length checks; list indexes are `(workspace_id, status, created_at desc, id desc)`.
- A new `upload_intents` table backs uploads (D-038). `docs/04` is amended accordingly (section 10).

## D-038 — Upload design
**Status:** ACCEPTED (advisor design review)
**Decision:** `POST .../assets/upload-intent` creates an intent (declared type and size, 10-minute expiry, status `pending`) and returns `PUT /api/v1/uploads/:intentId?exp&sig`. The signature is HMAC-SHA256 with a key derived from `SESSION_SECRET` and the label `upload`, over `v1|upload|intentId|workspaceId|userId|declaredSize|exp`, compared with `timingSafeEqual`. The PUT carries no bearer token and is on the public route list; the signature authorises it. It is single use: a conditional update moves the intent from `pending` to `receiving`, and success moves it to `received`. The body is streamed straight to its final server-chosen key (no temporary file, never buffered); a validating stream counts bytes, hashes them, holds data back until the first bytes match the declared type (JPEG, PNG, GIF, WebP, MP4; SVG and everything else rejected), and aborts with 413 past the declared size. A stalled upload (no data for 30 seconds) is cancelled, a rejected upload closes the connection, and the server has request and connection timeouts. Storage keys are `ws/{workspaceId}/{assetId}/original.{ext}` from the declared type; the user's filename is display text only. `complete-upload` needs the bearer token, requires the intent to belong to the caller and workspace (else 404), is idempotent, and only the request that moves the intent out of `received` may fail it or delete its file. Unfinished intents are swept after one hour by an atomic delete that never touches a completed one, and the file is removed only if that delete removed the row.
**Quotas per workspace:** 2 GiB, 500 files, 20 uploads in progress. Stored bytes include soft-deleted files until the purge removes them (30 days). An intent keeps its share reserved while `pending` and unexpired, and while `receiving` or `received` until it completes or is swept, even after its link expired. The totals are checked at intent creation and again inside the workspace lock at completion. Image cap 15 MB, video cap 200 MB.

## D-039 — Media reads
**Status:** ACCEPTED (advisor design review)
**Decision:** `GET /api/v1/media/:assetId/:variant?exp&sig` (variants `original`, `thumb`). The signature uses a separate derived key (label `media`) over `v1|media|assetId|workspaceId|variant|exp`; URLs live 15 minutes with `exp` rounded to 5-minute buckets. Each request re-checks that the asset is not deleted. Content type comes from the database row, with `nosniff`, `Content-Disposition: inline`, `Cache-Control: private, max-age=<remaining>` (overriding the global `no-store` for this route only) and a single `Range` request for video. Thumbnails use sharp with `limitInputPixels` 40 million, `failOn: 'error'`, first frame only, EXIF orientation applied and metadata stripped, WebP output at 512 px. Videos get no thumbnail in Phase 2. The extension manifest CSP gains `img-src 'self' <api origin>; media-src <api origin>` when the gallery reaches the panel.

## D-040 — API refinements
**Status:** ACCEPTED (advisor design review)
**Decision:** Every request body schema is `.strict()` (unknown fields, including `workspaceId` and `ownerUserId`, are rejected). Products are archived with `POST /products/:id/archive` and `.../unarchive` instead of `DELETE`. `PATCH` takes a partial body plus the current `version`; a stale version returns `409 CONFLICT` with the current version. Lists use an opaque cursor (`base64url({createdAt,id})`, ordered `(created_at desc, id desc)`), `limit` 1 to 100 (default 25), and return `{ items, nextCursor }`. List filters naming a foreign id return an empty list, never counts. Text is NFC-normalised and trimmed, control characters other than newline are removed, and length is counted after NFC. `sourceUrl` must be http or https without credentials.

## D-041 — Secure-by-default routes
**Status:** ACCEPTED
**Decision:** Authentication runs in `onRequest`, before body validation, so a stranger gets 401 and learns nothing about a route's schema. Workspace membership for `/workspaces/:workspaceId/...` routes is resolved in `preValidation`, so a non-member gets 404 whatever they send. At startup, every `/api/v1` route must be in `PUBLIC_ROUTES` or use the auth guard (and the workspace scope when it has `:workspaceId`), otherwise the app refuses to start. A test harness walks every registered route with a stranger's token and fails for any route without a fixture.

## D-042 — Product routes nested under the workspace
**Status:** ACCEPTED (supersedes the id-only product URLs in `docs/04` section 4)
**Context:** `docs/04` lists `GET/PATCH /products/:productId`. Id-only routes need a lookup among the caller's workspaces to find which workspace owns the id, which is one more place for an authorization mistake.
**Decision:** All product routes are `/api/v1/workspaces/:workspaceId/products[/:productId[/archive|/unarchive]]`. The workspace scope hook (D-025, D-041) then covers every route uniformly, and every repository query already carries `workspace_id`, so naming another workspace's product id under your own workspace returns 404 by construction. The same shape will be used for assets (`.../assets/...`). Product `DELETE` is replaced by `archive` and `unarchive` (D-040). Role rules: owners, admins and editors can change products; viewers and reviewers can only read.

## D-043 — Upload hardening found while testing
**Status:** ACCEPTED
**Context:** Testing the upload backend exposed two things the design review had not.
**Decision:**
- **Crash on a wrong file.** The upload validator rejects a bad file on its first chunk, before the storage layer has attached its error handler. With no listener, that `error` event is an uncaught exception that would terminate the API process, so one wrong file sent to a valid upload URL could take the service down. The validator now gets an error listener at creation; the failure still reaches the request through the pipeline. A test run that reports unhandled errors fails the build (non-zero exit), which is what catches a regression.
- **Per-route upload limit** (30 a minute per address by default) is configurable through `uploadRateLimitMax` so test suites can exercise many uploads; a dedicated test proves the default limit answers `429 RATE_LIMITED`.
- **Storage never deletes what it did not create.** A failed `put` onto an existing key removes nothing (found by a storage test).
- **Hand-written migration** `0003` carries the products-to-assets composite foreign key because Drizzle cannot type the circular reference; database tests prove the constraint.

## D-044 — Phase 2 security review fixes
**Status:** ACCEPTED (advisor review, 2026-11-03)
**Decision:** Fixed, each with a test that fails without it: expired-but-received uploads no longer escape the quota; deleted files count toward the quota until purged, and the purge is scheduled (every ten minutes, 30-day retention) and cannot be blocked by a stale cover; a request that loses a completion race can no longer fail the intent or delete the finished file; reading a stored file is treated as I/O (the intent stays usable) rather than as a decode failure; the sweeper deletes atomically and never a completed intent, and removes the thumbnail too; uploads have an idle timeout plus server request and connection timeouts and close the connection when rejected; setting a cover locks the asset in the update transaction; thumbnail decoding is limited to two at a time; migration 0004 adds a unique storage key and a positive received size.
**Accepted risks (documented, not fixed):**
- `LocalFsStorage` checks that a key's directory resolves inside the root, then opens the file. A local user who can already write inside `DATA_DIR` could swap a directory for a symlink between those two steps. The data directory must be writable only by the API's user. The hosted adapter will not have this property.
- A leaked signed media URL works until its expiry (up to 20 minutes because of 5-minute bucketing) and browsers may cache the response; deleting the file stops new requests only.
- Sweeping and a completion that read the file just before the sweep can leave an orphaned thumbnail; the retention purge does not cover orphans yet.

---

## D-045 to D-054 — Phase 3 plan (advisor, 2026-11-04)
**Status:** ACCEPTED. Mock provider only; no paid provider, no publishing.
- **D-045 Execution.** The `jobs` row holds all state. BullMQ carries only `{jobId}` (queue id `${jobId}:${attempt}`, `attempts: 1`, `removeOnComplete`/`removeOnFail`). A conditional update claims a job (`queued` to `running WHERE status='queued' AND run_after<=now()`), so a duplicate in Redis never runs twice. The worker holds a lease (`locked_until` plus heartbeat, database time). A reconciler runs every 30 s and re-queues stale queued rows and expired leases. Losing Redis loses nothing.
- **D-046 Routes.** All content and job routes nest under `/workspaces/:workspaceId/...` (follows D-042; supersedes id-only routes in doc 04 section 4). Job types: `generate_brief`, `regenerate_section`.
- **D-047 Idempotency.** `Idempotency-Key` (8-128 chars of `[A-Za-z0-9_-]`) is required on job-creating POSTs, unique per (workspace, user, key), stored with a request hash. Replay returns 200 with the original job; new job 202; same key with a different body 409 `IDEMPOTENCY_CONFLICT`. Created with `INSERT ... ON CONFLICT DO NOTHING` then select.
- **D-048 Retry.** `decideRetry(error, attempt)` is pure. Max 3 attempts, backoff 2 s, 10 s, 30 s plus jitter. Only transient errors (timeout, 5xx, rate limited with capped retry-after) retry. Permanent errors (validation, invalid output, `SECTION_CHANGED`, cancelled) fail at once. Error codes are stable; messages are safe to show.
- **D-049 Templates** live in code with id and version; the job input pins both. Custom templates deferred.
- **D-050 Sections.** Fixed set: title, hook, script, storyboard, caption, hashtags, callToAction. `section_state` jsonb holds `{rev, origin: generated|edited, jobId}`. Regenerate applies only if the section's `rev` is unchanged since the request, else the job fails `SECTION_CHANGED` and keeps its output. Generating never overwrites existing drafts.
- **D-051 Claim guard.** Deterministic post-processing on all provider output: each claim cites a product fact or is marked `needsReview`; matches against `restrictedClaims` go into `claimWarnings`.
- **D-052 Provider.** `TextProvider` and typed errors in `provider-core`. The mock is deterministic and Thai-first; failures are injected only by a name marker inside the mock adapter. One contract suite covers all adapters (D-009). Thai lengths count graphemes (`Intl.Segmenter`), NFC.
- **D-053 Delivery and limits.** UI polls with backoff (2 s to 10 s, stop at final state); no SSE yet. At most 5 active jobs per workspace; generate routes limited to 20 per minute.
- **D-054 Redis.** `scripts/redis-local.sh` (redis-server 7.0.15 present): bind 127.0.0.1, protected mode, generated password, `--appendonly yes`, `--maxmemory-policy noeviction`, non-root like pg-local. `REDIS_URL` config; password redacted. API tests use a fake `JobQueue`; worker tests call `processJob` and `reconcile` directly; one BullMQ smoke suite needs `REDIS_URL` (`SKIP_REDIS_TESTS=1` to skip); CI gets a `redis:7` service.
**Data model (all with `unique(workspace_id,id)` and composite FKs, D-037):** `campaigns`, `content_drafts`, `jobs` (adds `created_by`, `request_hash`, `attempts`, `max_attempts`, `run_after`, `locked_until`, `cancel_requested_at`).
**Slices:** S3.0 Phase 2 cleanups (Haiku); S3.1 contracts, provider, templates, claim guard (Haiku); S3.2 migration (orchestrator); S3.3 campaign CRUD (Haiku); S3.4 job repo, idempotency, queue, endpoints (orchestrator); S3.5 worker, retry, lease, reconciler, BullMQ, redis script (orchestrator); S3.6 drafts and regenerate (orchestrator + Haiku); S3.7 dashboard (Haiku); S3.8 extension (Haiku); S3.9 exit check (orchestrator).
**Phase 2 follow-ups from the same review (S3.0 DONE except the second item of the doc list: doc 07 is the MVP acceptance list, so its boxes stay unticked until the MVP is verified):** extension CSP has no `default-src` (set `default-src 'self'; img-src 'self' <api>; media-src <api>` with a manifest test; D-039 wording that images are blocked is wrong); `.env.example` missing `DATA_DIR`, `TRUST_PROXY_HOPS`, `ALLOW_MOCK_AUTH_ON_NETWORK`, `LOG_LEVEL`, `NODE_ENV`; doc 04 asset routes and doc 07 checkboxes stale; add `format:check` to CI; harness lacks a viewer-403 pass on every write route; gate the asset library for zero workspaces.
**Accepted for now:** signed URLs do not re-check membership (record before Phase 8 member removal); per-user disk is effectively 40 GiB (20 workspaces x 2 GiB); possible orphan thumbnail on refused completion; `POST /workspaces` not idempotent.

## D-055 — S3.2 schema for campaigns, drafts and jobs
**Status:** ACCEPTED (2026-11-04). Migration `0005_content_jobs`.
**Decision:** Three tables, all with `unique (workspace_id, id)` and composite foreign keys (D-037). `campaigns` links to `products (workspace_id, id)`. `content_drafts` links to `campaigns (workspace_id, id, product_id)`, so a draft is provably in its campaign's workspace and product. `jobs` links to campaigns and drafts through `(workspace_id, x_id)`. Idempotency is `unique (workspace_id, created_by, idempotency_key)` (D-047), with key and request-hash format checks. The job state machine is enforced by checks so impossible rows cannot exist: finished states have `finished_at` (and only they), a lease only while running, output only when succeeded (and always then), an error code only when failed or cancelled, a failed job has a code and a message, attempts never exceed `max_attempts` (1 to 5), and the target must match the type (`generate_brief` needs a campaign, `regenerate_section` needs a draft). Deletes are refused while rows reference each other (no cascades); campaigns and drafts are archived, not deleted. `sections`, `section_state` and `claim_warnings` are checked only for JSON shape; the application validates their content against the shared contract (D-050).
**Notes:** the job error-code list and the platform list exist in the schema, the contracts and (for provider errors) provider-core; keep them equal (a cross-check test comes with S3.4). `variant_index` is 0 to 2 and not unique, because generating again creates new drafts (D-050). An unknown job type is also refused by the target rule, so dropping only the type check would not be noticed by tests.

## D-056 — S3.4 job creation details
**Status:** ACCEPTED (2026-11-04). Refines D-045 to D-048 and D-053.
**Decision:** `POST /workspaces/:ws/jobs/generate-brief` (body `{campaignId}`, header `Idempotency-Key`) answers 202 for a new job and 200 for a replay; `GET /jobs`, `GET /jobs/:jobId`, `POST /jobs/:jobId/cancel`. Creation runs in one transaction that first locks the workspace row, then checks for a replay (same workspace, user and key: same request hash gives the original job, a different one gives 409 `IDEMPOTENCY_CONFLICT`), then the campaign (this workspace, not archived), then the cap of 5 queued or running jobs per workspace (429 `RATE_LIMITED`; replays still work at the cap), then inserts the job with a snapshot of the campaign's settings in `input` and writes the audit event. The job id goes to the queue only after the commit; if the hand-off fails the job stays queued, the API still answers 202, and the reconciler (S3.5) picks it up. Until S3.5 the default queue does nothing (`NullJobQueue`). The request hash covers the job type and the lower-cased campaign id, never the key. The header is validated after the permission check, so a read-only member gets 403 whatever they send; the generate route also has a per-client limit (default 20 a minute, `jobCreateRateLimitMax`). Cancel: a queued job is cancelled at once (`CANCELLED`, finished); a running job gets `cancel_requested_at` and stays running for its worker to stop; cancelling a cancelled job changes nothing; a finished job gives 409. All status changes are checked against one transition table (`transitions.ts`) and named in conditional updates.
**Notes:** the cap and replay logic is tested for concurrency only through the same-key race (ten at once), not through many different keys at once; the workspace lock makes both safe by construction. Shared cursor helpers now live in `platform/cursor.ts` (products, campaigns and jobs). A test (`db/constants.test.ts`) keeps the constant lists in the schema, the contracts and provider-core equal.

## D-057 — S3.5 worker, retry, lease, reconciler, BullMQ adapter
**Status:** ACCEPTED (2026-11-04). Refines D-045, D-048 and D-054.
**Decision:**
- **Process.** `pnpm dev:worker` runs `apps/api/src/worker.ts`, a separate process from the API. It needs `REDIS_URL`, consumes the queue with concurrency 2 and runs the reconciler now and every 30 s. The API uses the BullMQ queue when `REDIS_URL` is set and otherwise keeps `NullJobQueue` (jobs wait in the database; startup logs a warning).
- **Claim.** One conditional update moves `queued` to `running` only when the job is due (`run_after <= now()`) and has attempts left, adds one attempt and starts a 60 s lease. A duplicate message finds nothing to claim and does nothing.
- **Ownership.** Every later write names the status and the attempt number it expects. The heartbeat (every 20 s, database clock) renews the lease only for the attempt that holds it, and reports a cancel request. An attempt that lost the job (requeued by the reconciler, taken over by a newer attempt) stops and writes nothing.
- **Settle.** Success, failure, retry and cancel each run in one transaction that first locks the job row and checks ownership. A cancel request that arrived while the provider was busy wins over success, failure and retry: nothing is stored. Drafts are inserted in the same transaction as the job's success, so a retry or a lost lease can never leave half a result or duplicate drafts.
- **Retry.** `decideRetry` as in D-048 (3 attempts at most, the row may lower the limit, 2 s then 10 s plus up to 25% jitter, rate-limit `retryAfter` honoured and capped at 60 s). An unknown error is `INTERNAL` with a fixed message and is never retried; nothing from the error text reaches the row or the logs. A retry goes back to `queued` with `run_after` set on the database clock and is handed to the queue as the next attempt.
- **Reconciler.** Running jobs whose lease ran out go back to the queue (or fail with `INTERNAL` "The job stopped responding." when no attempt is left, or are cancelled when a cancel was requested); queued jobs with no attempts left fail; queued jobs more than 60 s overdue are offered to the queue again. Rows are locked with `FOR UPDATE SKIP LOCKED`, so two reconcilers share the work.
- **Queue message id.** BullMQ refuses a colon in a custom id, so the id is `${jobId}_${attempt}` (not `:` as D-045 wrote it). The same attempt is queued once; the next attempt can be queued from inside the current one. `attempts: 1`, `removeOnComplete` and `removeOnFail` are on, so a lost or failed message never blocks a re-offer. `enqueue` gives up after 2 s so a Redis outage cannot stall a request; the job stays queued and the reconciler picks it up.
- **Redis script.** `scripts/redis-local.sh {start|stop|status|reset|url}`: 127.0.0.1 only, protected mode, generated password kept in `.data/redis.pass` (mode 600) and written to a mode-600 config (never on a command line), append-only file, `noeviction`, runs as the unprivileged user `redisdev` when started as root. `REDIS_URL` is optional config; its password is redacted (the URL redaction now also covers an empty user name, `redis://:pw@host`).
- **Tests.** Queue tests need `REDIS_URL` and fail loudly without it; `SKIP_REDIS_TESTS=1` skips them on purpose. CI has a `redis:7` service.
**Not covered:** `regenerate_section` jobs (S3.6; a job of that type fails `INTERNAL` "not supported yet" until then). Real provider calls are limited by `providerTimeoutMs` (30 s) through an abort signal; the mock ignores it. A worker killed in the middle of a database commit relies on PostgreSQL atomicity. BullMQ's own stalled-job check is left at its default; the database lease is what decides.

## D-058 — S3.6 drafts and regenerate-section
**Status:** ACCEPTED (2026-11-04). Refines D-046 and D-050.
**Decision:**
- **Routes** (nested under the workspace, D-046): `GET /drafts` (optional `campaignId`, cursor paging), `GET /drafts/:draftId`, `PATCH /drafts/:draftId`, `POST /jobs/regenerate-section` (body `{draftId, section, expectedRev}`, `Idempotency-Key` as in D-047). Reads are open to every member; writes need owner, admin or editor (403 otherwise, 404 for a stranger).
- **PATCH.** The body carries the `version` the client saw and at least one section; a stale version answers 409 with `details.currentVersion`. The draft row is locked first. Each section goes through the same validation as provider output (`validateSectionValue`: NFC, grapheme limits, hashtag rules); a refusal is a 400 naming `sections.<name>`. A section whose value really changes gets `rev + 1`, `origin: edited`, `jobId: null`; a value equal to the stored one changes nothing, and a request that changes nothing does not raise the version. The claim guard runs again over the whole draft (warnings and `needsReview` are recomputed, so a fixed claim clears its warning). Changed content sends an `in_review` or `approved` draft back to `draft` unless the request names a status. A status given with unchanged sections still changes the status (version + 1, no revision change).
- **Regenerate job.** Created with the shared creation path (workspace lock, replay check, cap, insert, audit, enqueue after commit); only the preparation differs. Refused with 400 if the draft is not in this workspace, 409 if the section's `rev` is not `expectedRev` or the campaign is archived. The job row has `draftId` set and `campaignId` null; `input` holds the section, `expectedRev` and a snapshot of the campaign's template, language, tone, platform and duration, plus the draft's `variantIndex`. The request hash is the type plus `draftId:section:expectedRev`.
- **Worker.** The handler re-checks the revision before calling the provider (no provider call for a stale job), then asks for the one section, rejects an answer for another section, validates the value again, and returns it without writing. The settle step runs in the job's transaction: it locks the draft row, checks the revision a second time, then writes the value with `rev + 1`, `origin: generated`, the job id, a recomputed claim guard and version + 1; status goes back to `draft`. A moved revision fails the job `SECTION_CHANGED` (permanent, never retried) and leaves the draft exactly as the edit left it. A cancel request still wins over success. The edit always wins; an equal value succeeds with `changed: false`.
- **Lock order.** The job settle locks the job row, then the draft row; PATCH locks only the draft row; cancel locks only the job row. No cycle.
**Notes:** D-050 said a failed job "keeps its output"; the table allows output only on success (D-055), so a `SECTION_CHANGED` job stores no output. The settle-time lock has no deterministic concurrent test (the race test edits while the provider runs, which the second revision check catches; the row lock itself is what makes the check and the write atomic). A regenerated section replaces the old value; there is no history or undo yet.

## D-059 — UI direction for S3.7 and S3.8
**Status:** ACCEPTED (2026-11-04). Based on `docs/UI_RESEARCH.md`.
**Decision:** Take design ideas only, no code from other products (Postiz is AGPL-3.0). S3.7 builds: a short "create campaign and generate" path from a product; variants as tabs; section cards with origin badge, edit, regenerate and copy; a status control with the reset-to-draft rule shown; quiet claim-warning badges; a job panel that stays visible with cancel, skeletons, retry as a new request with a new idempotency key, polling 2 s to 10 s (D-053); explicit 409 handling for stale saves and `SECTION_CHANGED`. S3.8 reuses the same states in the side panel with a smaller layout. Out of scope: streaming, calendar and scheduling, diff and undo, visual editor, anything that publishes. AutoGenX (added 2026-11-04) confirms the template-as-mode idea and the hero, detail, usage, final-shot storyboard arc; its account warm-up and browser-automation posting are explicitly not to be copied.
**Notes:** the research covered open-source READMEs and secondary sources for commercial tools; their own UIs were not inspected. Thai copy needs native review (Q-005).

## D-060 — Publishing plan (owner request 2026-11-04)
**Status:** ACCEPTED (2026-11-04). Refines D-022 and the compliance boundaries in `CLAUDE.md`; changes neither.
**Context:** The owner wanted auto-posting through a desktop Chrome program plus an Android phone (as a competitor does), with human-like delays and mouse paths so the platforms would not detect automation, because official APIs are hard to get. The compliance boundaries forbid undocumented posting routes and detection evasion; the owner agreed to the plan below instead.
**Decision:**
1. **Assisted posting (first, quick MVP, part of the export phase).** The extension, on a user click on an approved draft, opens the platform's own upload page in a new tab, puts the caption and hashtags on the clipboard, and tells the user which file to attach. The user presses Post. No automation of the target page, no scripted clicks or typing, no extra host permissions beyond opening a tab (the exact permission is checked when the slice is planned).
2. **Official APIs, one platform at a time (Gate B, D-022).** Order: Facebook Pages (Graph API; needs `pages_manage_posts` and Meta App Review), TikTok "Upload" to the creator's inbox as a draft (lower approval bar than Direct Post; Direct Post only after an audit, until then posts are private), Shopee after its Open Platform documentation is read. Approval times and costs in the research notes come from third-party sources and must be confirmed against each platform's own documentation before a slice is planned. Start the Facebook and TikTok applications early; they take weeks.
3. **Not built:** posting through desktop or phone UI automation, human-like mouse or timing to avoid detection, account warm-up, fingerprint or proxy tricks. Revisiting this needs the owner to change `CLAUDE.md` and D-022 explicitly, and detection evasion would still not be built.
**Notes:** Assisted posting needs no platform approval, so it is the only publishing path that can ship before Gate B. Fits `docs/UI_RESEARCH.md` (hand off through the platform's own screens; copy format friendly to LINE and Facebook).

## D-061 — S3.8 side panel: campaigns, generate and job status
**Status:** ACCEPTED (2026-11-04). Refines D-059 and D-053; adds no permission and no host access (D-022, D-039).
**Decision:**
- **Panel.** Below the product list, a "Campaigns" section shows the newest 10 campaigns of the active workspace (archived ones are left out in the panel), each with a Generate button, its latest generation job's status, and a link to the campaign page in the dashboard, where drafts are edited. The panel does not edit drafts and does not create campaigns (links to the dashboard for both).
- **Who sees Generate.** Owner, admin and editor only (the same roles as `useCanWrite` in the dashboard). Reviewer and viewer see the statuses and links but no button. The API is still the gate (403).
- **State comes from the API only.** The panel reads `client.jobs.list` with `type=generate_brief` and takes the newest job per campaign (the list is newest first). Nothing is kept in extension storage or the service worker, so reopening the panel shows the same status.
- **Polling.** The job list is polled with the D-053 steps (2 s to 10 s) only while a listed job is queued or running; it stops at a final state.
- **Generate.** One `Idempotency-Key` per click, made with `crypto.randomUUID()` (prefix `ext-`). The key is reused only when the request got no response (network error or timeout) for the same campaign; after a success or any other error the next click makes a new key. This is the rule of `useGenerateBrief` (dashboard), copied, because the two apps do not share UI hooks. The button is disabled while a start is pending or the campaign's latest job is queued or running. After a failed or cancelled job the same button reads "Try again" and starts a new job with a new key.
- **Cancel.** Shown for queued and running jobs, as in the dashboard `JobPanel`. A running job stays "Stopping…" until the worker reports the outcome (polling keeps going).
- **Shared code.** `pollDelayMs` and `isTerminalJobStatus` move from the dashboard into `packages/contracts` (`jobPolling.ts`), so both apps use one copy; the dashboard keeps its exports unchanged.
- **Errors.** Every failed request shows the API message and request id where present (`ApiError`), never a raw error; `RATE_LIMITED` (cap of 5 active jobs, or 20 starts a minute) shows its message as is.
- **Out of scope:** streaming, creating campaigns in the panel, editing or viewing draft sections, claim-warning badges, retry of a single section, product images, notifications.
**Known limit:** the job list shows only the newest 50 generate jobs of the workspace (one page). A campaign whose latest job is older than that shows no status; the link to the dashboard still works. Fixing it needs a `campaignId` filter on `GET /jobs` (a later slice, if the panel needs it).

## D-062 — Phase 4 text provider (owner answer to Q-001, 2026-11-04)
**Status:** ACCEPTED. Gate 1 of D-022 is met for development and pilot use only (terms gap noted below).
**Context:** The owner chose an OpenAI-compatible API from `maxplus-ai.cc` and will review the Thai output. The site's own pages say: it is an "API proxy" with pay-as-you-go pricing; base URL `https://api.maxplus-ai.cc/v1`; Chat Completions and Responses are listed for some pools; keys look like `ccsk-` plus 64 hex characters; `GET /v1/me` returns the balance (`credit_usd`); a key can carry a spend cap (`limit_usd`) and returns 402 at zero balance and 429 at its cap; tasks and files are kept 3 days. The pages do not name an operator, a company or a country, and no terms of service, privacy policy, logging or training policy, or official-reseller statement was found. A model-written summary of the docs said the service may be shut down; that was not confirmed. Text-model rate limits and per-model prices were not readable. Nothing has been called yet.
**Decision:**
1. Build one generic **OpenAI-compatible text provider** behind the existing `provider-core` text-provider interface (S3.1): base URL, model, API key, and price per million input and output tokens are server configuration (`TEXT_PROVIDER_*`), never extension or browser settings. It uses Chat Completions with a JSON-schema or JSON-object response, validated by the existing output validation and claim guard. `mock-text` stays the default and the test provider; the real provider turns on only when all settings are present.
2. The MaxPlus gateway is **development and pilot only**. Because the operator and its data handling are unknown, send only the product text the owner enters; no customer data, no personal data, no unpublished third-party material. Moving to the official provider is a configuration change, not a code change. Record the official vendor as the production choice under Q-001 before any hosted release.
2a. **Read from the gateway's own docs and a read-only management call (2026-11-04):** the API docs page says "ขณะนี้ไม่มี pool ที่เปิดให้บริการ — admin ปิดระบบไว้ชั่วคราว" (currently no pool is open for service; the admin has temporarily shut the system down). So the gateway may refuse text calls until it reopens; S4.0 must check this first and the adapter must map it to `PROVIDER_UNAVAILABLE`. Inference calls need a `ccsk-` key (a `ccmk-` management token is refused with 401 on `/v1/me` and `/v1/models`). A management token manages keys (`GET/POST/PATCH/DELETE /v1/api-keys`, reroll, per-key usage); `POST /v1/api-keys` accepts `name`, `limit_usd`, `limit_period` and `pool` and shows the new secret once. A listing of the owner's account showed nine existing keys, none with a spend cap, one of them already used for well over the 100-credit budget on other projects. Therefore this project needs its own key with `limit_usd` = 100 (D-063); the app must never receive a management token, and no existing key is reused. Pools have their own base paths; the plain base URL is the `native` pool (`/v1/chat/completions`, `/v1/responses`, `/v1/models`). Rate limits found: `GET /v1/me` 60 per minute per key, `GET /v1/usage` 20 per minute per key, 30 concurrent text streams per worker; text-request limits per minute were not found.
3. **Verify before trusting:** the first slice (S4.0) makes one real call with the owner's key to `/v1/models`, `/v1/me` and one Chat Completions request with a Thai prompt, and records the observed model names, response shape, latency, usage fields and the price actually charged. Until then nothing in this decision is claimed to work.
4. Default model: the cheapest listed GPT-class small model that passes the S4.5 Thai evaluation; pick from the real `/v1/models` list, not from the marketing page.
5. Retry follows D-048: bounded; 429, 5xx and timeouts retry with backoff; 400, 401, 402, 403 and schema failures do not. Stable error codes: `PROVIDER_AUTH`, `PROVIDER_BUDGET`, `PROVIDER_RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_BAD_OUTPUT`.
6. The key lives only in a server environment variable and is added to the redaction list. The key must never be pasted into chat, committed, logged, or sent to the browser. `.env.example` carries a placeholder only.

## D-063 — Phase 4 spend control (owner answer, 2026-11-04)
**Status:** ACCEPTED.
**Context:** The owner set a budget of 100 credits. The site states the top-up rate as ฿1 = $3 of credit and bills on actual tokens, so 100 credits is about ฿33; the credit unit equals one US dollar of model price (`credit_usd`).
**Decision:** The cap is enforced in three layers, and any missing layer fails closed:
1. **App cap:** a per-workspace usage ledger records every provider call (job, model, input and output tokens, cost in credits from the configured prices). Before a call, the worker refuses with `PROVIDER_BUDGET` if spent plus the call's worst-case cost would pass `TEXT_PROVIDER_BUDGET_CREDITS` (default 100, set to the owner's value). Worst-case cost uses the request's maximum output tokens.
2. **Key cap:** the owner sets `limit_usd` = 100 on the gateway key, so the gateway refuses even if the app has a bug.
3. **Reconciliation:** S4.3 compares the ledger with `GET /v1/me` and shows both; a gap above 10 percent is shown as a warning.
The real provider refuses to start without configured prices (no guessed defaults). Generation also needs the user's explicit confirmation of the estimated cost in the UI before a real-provider job is created; mock jobs need none. Usage and cost events never store prompts or outputs.
**Q-005:** the owner reviews the Thai output. S4.5 drafts about 20 product briefs (three categories, with restricted claims and empty selling points among them) and a score sheet (natural Thai, matches facts, no unsupported claim, tone); the owner scores them. The provider and model pass only if the owner accepts the result.

## D-064 — S5.0: Phase 3 follow-ups from the advisor checkpoint (2026-11-04)
**Status:** ACCEPTED. Supersedes the branch name in D-017 and the D-061 job-window limit; refines the doc 07 rule in D-045 to D-054.
**Context:** The advisor reviewed Phase 3 before Phase 5 (export). Findings: the side panel read only the newest 50 generate jobs (D-061), so an older campaign showed no status; "reopen the panel" and "failed job" had no end-to-end proof; the docs named two branches and still said Phase 3 was next; the doc 07 boxes were ticked without a rule.
**Decision:**
1. **`GET /campaigns` returns `latestGenerateJob`** on each item (`CampaignListItem`, null when never generated), read in one query (`DISTINCT ON (campaign_id)`) scoped to the workspace. The side panel uses it and polls the campaign list while a listed job is queued or running, so state is exact for any number of jobs. A `campaignId` filter on `GET /jobs` alone was rejected: it would cost one request per campaign on every poll. `GET /campaigns/:id` and create are unchanged.
2. **`GET /jobs` accepts `campaignId` and `draftId`** (export status needs `draftId`). A malformed or foreign id matches nothing and never reaches a uuid column.
3. **Branch:** work on the branch the session designates; today that is `ccr-186e9c63-3y215n`. The older `ccr-14958772-bzlatd` is an ancestor and is retired. Update this line when the designated branch changes.
4. **Acceptance ticks:** a box in `docs/07` or an exit criterion in `docs/06` is ticked only when an automated test or a recorded live run proves it, with the evidence named in `docs/IMPLEMENTATION_STATUS.md`. The release gate still needs every P0 box. The Phase 2 boxes that have evidence from the Phase 2 exit check are reconciled in the Phase 5 exit check (S5.9).
5. **Evidence added:** side-panel e2e that closes the panel, opens a new one and sees the same queued job, and shows the job was not cancelled; dashboard e2e that runs a refused generation through the real worker, shows the plain message and Try again, and checks one attempt only.
6. **Known limit:** the mock Thai Script repeats a line; it needs native review (Q-005, D-063), not code.

## D-065 — Phase 4 default provider: OpenRouter (2026-11-04)
**Status:** ACCEPTED. Refines D-062 and D-063; changes no code plan, because the adapter is generic.
**Context:** The owner suggested OpenRouter instead of the MaxPlus gateway. The MaxPlus docs say no pool is open (D-062 item 2a), and its operator, terms and data handling are unknown. OpenRouter's own pages (read 2026-11-04; nothing called yet) say: base URL `https://openrouter.ai/api/v1`, Chat Completions "very similar to OpenAI's"; operated by OpenRouter, Inc., New York, USA; "OpenRouter does not store your prompts or responses, unless you opt in" (logging off by default) and "does not use your Inputs or Outputs for model training"; per-request `provider.zdr` and an account setting that avoids providers that train; per-key credit limit through the management API (`limit`, `limit_reset`); `GET /api/v1/key` returns `limit`, `limit_remaining` and usage; responses carry `usage` and, per the schema, `cost`; `/models` lists USD-per-token `pricing.prompt` and `pricing.completion`; structured output with `response_format` `json_schema`, and `require_parameters: true` to route only to endpoints that support it (support is per endpoint, strict compliance not guaranteed); minimum purchase $5; credits may expire after 365 days; a 402 carries `limit_source` (`openrouter_key_limit`, `openrouter_credits`, `openrouter_in_flight_budget`); paid models have no platform request cap. The pages do not name any Thai-strong model.
**Decision:**
1. The default real provider is **OpenRouter**; the same adapter serves MaxPlus or any OpenAI-compatible endpoint by configuration (`TEXT_PROVIDER_BASE_URL`, model, key, prices). MaxPlus is only used if it reopens and the owner prefers it.
2. **Money:** OpenRouter credits are US dollars. The owner sets the real cap; the recommended pilot is **$10 or less**. D-063's `TEXT_PROVIDER_BUDGET_CREDITS` is read as dollars for OpenRouter. The owner creates a key with a credit limit (a management key makes that one call; the app never holds a management key).
3. **Data:** send `provider: { zdr: true }` when the chosen model has a ZDR endpoint, or at least `data_collection: "deny"` (exact parameter to be read from the provider-selection page in S4.0); set the account to avoid training providers; keep prompt logging off. Only product text the owner enters is sent.
4. **Structured output:** request `response_format` `json_schema` with `require_parameters: true`; validate every reply with the existing output validation anyway (the docs say strict compliance is not guaranteed).
5. **Cost source:** use `usage.cost` from the reply when present, and otherwise tokens times the configured prices; reconcile with `GET /api/v1/key` (`usage`, `limit_remaining`) in S4.3.
6. **Error mapping:** 401 `PROVIDER_AUTH`; 402 `PROVIDER_BUDGET` (key limit or credits; an in-flight-budget 402 retries after `Retry-After`); 403 moderation or refusal `CONTENT_REFUSED` (permanent); 400 and bad output permanent; 408, 429, 502, 503 and 504 retry within D-048 and respect `Retry-After`.
7. **Model choice** is made in S4.5 from the owner's Thai scores, among models listed with `structured_outputs` support and a price the owner accepts; S4.0 reads `/models` to shortlist. No model is chosen on marketing claims.
8. S4.0 stays blocked until the owner sets a capped key in `TEXT_PROVIDER_API_KEY`. Nothing in this entry is claimed to work until a real call succeeds.

## Open questions

Each question lists what is needed and the default that applies if no answer arrives.

### Q-001 — Real text generation provider
**Gate:** Phase 4.
**Needed:** Provider choice; current terms on commercial use of outputs and data retention; Thai quality on a test set; cost per unit; whether the owner supplies the key.
**Default:** Stay on `mock-text`; Phase 4 does not start.

### Q-002 — Real image and video providers
**Gate:** Phase 6.
**Needed:** An official API (not browser access), terms, cost per image and per video second, reference-image support, output rights, and a spending cap.
**Default:** Image and video are manual import only.

### Q-003 — Production auth provider
**Gate:** before any hosted deployment.
**Default:** Mock auth only, local use.

### Q-004 — Object storage vendor
**Gate:** before any hosted deployment.
**Default:** Cloudflare R2 unless the owner already uses AWS.

### Q-005 — Thai copy evaluation
**Gate:** Phase 4.
**Needed:** Two or three native-speaker reviewers and about 20 product briefs.
**Default:** Schema validation and manual review by the owner.

### Q-006 — Extension distribution
**Gate:** before beta.
**Needed:** Whether to publish on the Chrome Web Store and who owns the developer account; a stable extension id for CORS and OAuth redirect.
**Default:** Load unpacked for development and the alpha.

### Q-007 — Production hosting
**Gate:** before any hosted deployment.
**Default:** Undecided; local-first.

---

## Platform status (from `00` §10 and `06` Phase 7)

| Platform | Status | Gate |
|---|---|---|
| TikTok Content Posting API | DEFERRED to Phase 7 | App registration, `video.publish` scope, audit; private visibility until audited |
| Facebook Pages API | DEFERRED to Phase 7 | Meta app review and a Page test account |
| Instagram Platform API | DEFERRED beyond Phase 7 | Professional-account eligibility and permissions |
| Shopee Open Platform | OPEN, not started | Confirm Thailand seller eligibility and a media-publish API before any design |

No platform is shown as connected until a successful sandbox test is recorded here.
