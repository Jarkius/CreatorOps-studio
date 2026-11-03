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
- `products.primary_asset_id` references `assets(workspace_id, id)` with `ON DELETE SET NULL (primary_asset_id)` (PostgreSQL 15+; the project uses 16). Deleting an asset is a soft delete (`status`, `deleted_at`) and clears the product's primary image in the same transaction.
- Products carry `version int` (optimistic concurrency), `status` (`active`/`archived`) and `archived_at`. Price is `numeric(12,2)` with a 3-letter currency, both null or both set; never a float.
- `selling_points` and `restricted_claims` are `jsonb` arrays checked with `jsonb_typeof = 'array'`; Zod limits each to 20 strings of 1 to 300 characters.
- Text columns have length checks; list indexes are `(workspace_id, status, created_at desc, id desc)`.
- A new `upload_intents` table backs uploads (D-038). `docs/04` is amended accordingly (section 10).

## D-038 — Upload design
**Status:** ACCEPTED (advisor design review)
**Decision:** `POST .../assets/upload-intent` creates an intent (declared type and size, 10-minute expiry, status `pending`) and returns `PUT /api/v1/uploads/:intentId?exp&sig`. The signature is HMAC-SHA256 with a key derived from `SESSION_SECRET` and the label `upload`, over `v1|upload|intentId|workspaceId|userId|declaredSize|exp`, compared with `timingSafeEqual`. The PUT carries no bearer token and is on the public route list; the signature authorises it. It is single use (`pending` to `received` by a conditional update). The body is streamed to a mode-0600 temporary file, never buffered; a counting stream aborts with 413 past the declared size or the cap; the first bytes must match the declared type (JPEG, PNG, GIF, WebP, MP4; SVG and everything else rejected). Storage keys are `ws/{workspaceId}/{assetId}/original.{ext}` from the detected type; the user's filename is display text only. `complete-upload` needs the bearer token, requires the intent to belong to the caller and workspace (else 404), and is idempotent. A sweeper removes stale intents and temporary files. Quotas per workspace: 2 GB stored, 500 assets, 20 pending intents, checked at intent and at completion under a row lock. Image cap 15 MB, video cap 200 MB.

## D-039 — Media reads
**Status:** ACCEPTED (advisor design review)
**Decision:** `GET /api/v1/media/:assetId/:variant?exp&sig` (variants `original`, `thumb`). The signature uses a separate derived key (label `media`) over `v1|media|assetId|workspaceId|variant|exp`; URLs live 15 minutes with `exp` rounded to 5-minute buckets. Each request re-checks that the asset is not deleted. Content type comes from the database row, with `nosniff`, `Content-Disposition: inline`, `Cache-Control: private, max-age=<remaining>` (overriding the global `no-store` for this route only) and a single `Range` request for video. Thumbnails use sharp with `limitInputPixels` 40 million, `failOn: 'error'`, first frame only, EXIF orientation applied and metadata stripped, WebP output at 512 px. Videos get no thumbnail in Phase 2. The extension manifest CSP gains `img-src 'self' <api origin>; media-src <api origin>` when the gallery reaches the panel.

## D-040 — API refinements
**Status:** ACCEPTED (advisor design review)
**Decision:** Every request body schema is `.strict()` (unknown fields, including `workspaceId` and `ownerUserId`, are rejected). Products are archived with `POST /products/:id/archive` and `.../unarchive` instead of `DELETE`. `PATCH` takes a partial body plus the current `version`; a stale version returns `409 CONFLICT` with the current version. Lists use an opaque cursor (`base64url({createdAt,id})`, ordered `(created_at desc, id desc)`), `limit` 1 to 100 (default 25), and return `{ items, nextCursor }`. List filters naming a foreign id return an empty list, never counts. Text is NFC-normalised and trimmed, control characters other than newline are removed, and length is counted after NFC. `sourceUrl` must be http or https without credentials.

## D-041 — Secure-by-default routes
**Status:** ACCEPTED
**Decision:** Authentication runs in `onRequest`, before body validation, so a stranger gets 401 and learns nothing about a route's schema. Workspace membership for `/workspaces/:workspaceId/...` routes is resolved in `preValidation`, so a non-member gets 404 whatever they send. At startup, every `/api/v1` route must be in `PUBLIC_ROUTES` or use the auth guard (and the workspace scope when it has `:workspaceId`), otherwise the app refuses to start. A test harness walks every registered route with a stranger's token and fails for any route without a fixture.

---

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
