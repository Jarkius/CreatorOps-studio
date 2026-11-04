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
| D-017 | Git: branch `ccr-14958772-bzlatd`; commits when asked; no pull request unless requested | ACCEPTED |
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
| Q-001 | Real text generation provider | OPEN (gate for Phase 4) |
| Q-002 | Real image and video providers and cost model | OPEN (gate for Phase 6) |
| Q-003 | Production auth provider | OPEN (before any hosted deployment) |
| Q-004 | Object storage vendor | OPEN (before any hosted deployment) |
| Q-005 | Thai copy evaluation set and reviewers | OPEN (before Phase 4) |
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
**Decision:** Work on branch `ccr-14958772-bzlatd`. Commit and push when the owner asks (a stop-hook request counts). No pull request unless explicitly requested.

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
