# CreatorOps Studio — Decision Log

**Last updated:** 2026-11-03

Status values:

- `PROPOSED`: recommended, waiting for owner approval. Work does not start on the item until it is `ACCEPTED`.
- `ACCEPTED`: approved; implement as written.
- `OPEN`: question that needs an answer before the related work begins.
- `DEFERRED`: intentionally postponed; revisit at the listed phase.
- `REJECTED`: considered and declined; do not reintroduce without a new decision.

Each decision has a short rationale and the reference it depends on. Change a decision by adding a new entry that supersedes it, not by editing history.

---

## Summary

| ID | Decision | Status |
|---|---|---|
| D-001 | Modular monolith with a separate worker process | PROPOSED |
| D-002 | pnpm workspaces monorepo | PROPOSED |
| D-003 | Fastify for the API (not NestJS) | PROPOSED |
| D-004 | Drizzle ORM (not Prisma) | PROPOSED |
| D-005 | PostgreSQL from day one, including local development | PROPOSED |
| D-006 | Redis + BullMQ, with the database row as source of truth | PROPOSED |
| D-007 | React + Vite + Tailwind + TanStack Query + React Hook Form + Zod | PROPOSED |
| D-008 | Local filesystem storage behind a StorageAdapter; S3/R2 later | PROPOSED |
| D-009 | Provider adapters behind interfaces; mock providers in Phase 1 | PROPOSED |
| D-010 | No publishing connector in Phase 1; manual export only | PROPOSED |
| D-011 | Single-user local auth with workspace scoping from day one | PROPOSED |
| D-012 | Chrome extension deferred until after Phase 2 | PROPOSED |
| D-013 | Phone-farm and device-control features excluded | ACCEPTED (spec §4.4, §12) |
| D-014 | No browser automation of consumer AI websites | ACCEPTED (spec §4.1C, §4.4) |
| D-015 | Thai is the default content language; English optional | PROPOSED |
| D-016 | No billing or pricing implementation before product validation | ACCEPTED (spec §14.2, §6.4) |
| D-017 | Work on branch `ccr-14958772-bzlatd`; no pull request unless requested | ACCEPTED |
| D-018 | Greenfield repository: scaffold from scratch, no imported code | PROPOSED |
| Q-001 | Real text generation provider | OPEN |
| Q-002 | Real image and video providers and cost model | OPEN |
| Q-003 | Hosted auth provider | OPEN (Phase 4) |
| Q-004 | Object storage vendor (R2 or S3) | OPEN (Phase 4) |
| Q-005 | Thai copy evaluation set before Phase 2 | OPEN |

---

## D-001 — Modular monolith with a separate worker process

**Status:** PROPOSED
**Context:** Spec §6.1 recommends a modular monolith with background workers. The team is one developer.
**Decision:** One API process, one worker process, one web app, shared packages. No microservices.
**Consequences:** Simple deployment and debugging. Module boundaries are enforced by package layout and lint rules so a later split stays possible.

## D-002 — pnpm workspaces monorepo

**Status:** PROPOSED
**Context:** The app has web, API, worker, and shared code. Spec §6.3 does not choose a package manager.
**Decision:** pnpm workspaces. Packages: `apps/web`, `apps/api`, `apps/worker`, `packages/{domain,db,providers,prompts,storage,config}`.
**Consequences:** Shared types and Zod schemas without publishing packages. Dependency direction is documented in `ARCHITECTURE.md` §2.

## D-003 — Fastify for the API

**Status:** PROPOSED
**Context:** Spec §6.3 says Fastify for a lean MVP, NestJS if the repo already uses it. This repo is empty, so there is no existing choice.
**Decision:** Fastify with Zod-based validation and OpenAPI generated from route schemas.
**Consequences:** Less framework ceremony than NestJS. Team must keep the module pattern in `ARCHITECTURE.md` §3 by convention.

## D-004 — Drizzle ORM

**Status:** PROPOSED
**Context:** Spec §6.3 requires one of Prisma or Drizzle. Drizzle is closer to SQL, has light runtime, and keeps migrations as plain SQL files.
**Decision:** Drizzle ORM with `drizzle-kit` for migrations. Raw SQL only where reviewed (spec §18 Step 4).
**Consequences:** Schema is TypeScript. Migrations are committed SQL. Do not mix in Prisma.

## D-005 — PostgreSQL from day one

**Status:** PROPOSED
**Context:** Spec §6.4 allows SQLite for a throwaway prototype only and prefers PostgreSQL when jobs or teams are expected. Jobs and idempotency constraints are required in Phase 1.
**Decision:** PostgreSQL in Docker Compose for local development and tests. No SQLite path.
**Consequences:** Developers need Docker. Dialect differences are avoided entirely.

## D-006 — Redis + BullMQ with database as source of truth

**Status:** PROPOSED
**Context:** Spec §6.3 names Redis + BullMQ. Spec §17 criterion 5 requires jobs to survive refresh. Redis adds one more local service.
**Decision:** BullMQ holds queue messages only. `GenerationJob` rows hold state, progress, attempts, and errors. A reconciler re-enqueues stale `QUEUED` rows.
**Consequences:** Losing Redis delays work but loses nothing. Phase 1 needs Redis in Compose; keeping it avoids a rewrite in Phase 2.

## D-007 — Frontend stack

**Status:** PROPOSED
**Context:** Spec §6.3 lists React, Vite, Tailwind, TanStack Query, React Hook Form, Zod, and optional Zustand.
**Decision:** Use all listed tools except Zustand, which is deferred until a real client-state need appears.
**Consequences:** Forms and API share one Zod schema source in `packages/domain`.

## D-008 — Local storage behind StorageAdapter

**Status:** PROPOSED
**Context:** Spec §6.3 and §6.4: local filesystem for development and single-user mode, S3-compatible storage for hosted mode.
**Decision:** `StorageAdapter` interface with `LocalFsStorage` in Phase 1. Keys are generated server-side. Original uploads are immutable.
**Consequences:** Hosted storage is an adapter swap. Lineage uses `parent_asset_id` rather than overwriting.

## D-009 — Provider adapters with mocks in Phase 1

**Status:** PROPOSED
**Context:** Spec §8 defines interfaces. Spec §18 Step 3 (item 5) requires a text adapter with mocked provider tests. Phase 0 provider validation is not complete.
**Decision:** Implement interfaces from spec §8, add a typed error taxonomy, and ship only mock adapters in Phase 1. Real adapters follow Q-001 and Q-002.
**Consequences:** Phase 1 has no provider dependency or cost. Every adapter must pass the same contract suite.

## D-010 — Manual export only in Phase 1

**Status:** PROPOSED
**Context:** Spec §4.1E and §10.5. No platform connector is approved. Spec §14 requires official APIs only.
**Decision:** Phase 1 exports a zip package and a checklist. The `PublishingProvider` interface and a manual-only adapter arrive in Phase 2. No platform API code exists before Phase 3.
**Consequences:** No platform account or secret handling in Phase 1–2.

## D-011 — Single-user auth, workspace scoping from day one

**Status:** PROPOSED
**Context:** Spec §4.1F and §17 criterion 8. Spec §18 Phase 1 lists "basic auth / local single-user mode."
**Decision:** Seeded local user with `OWNER` role. Every service and repository takes `workspaceId`. Authorization tests run against all routes from the first route.
**Consequences:** Adding real auth later changes the login layer only.

## D-012 — Chrome extension deferred

**Status:** PROPOSED
**Context:** Spec §4.1 does not require the extension in the MVP. Spec §11 designs it as a companion. The reference screenshots show a side panel, but the web app covers the same workflow.
**Decision:** Build the web app first. Revisit the extension after Phase 2 with a written design.
**Consequences:** Phase 1 has one client. Extension messaging contract is designed later.

## D-013 — Phone-farm and device-control features excluded

**Status:** ACCEPTED
**Context:** Spec §4.4 and §12 exclude engagement automation, warm-up, and multi-device bot control. The owner's stream screenshots show a rack of phones with TikTok and Shopee open.
**Decision:** No device-control code, ADB integration, or multi-device orchestration. An optional single-device file-transfer companion may be reconsidered only after a validated user need and a written policy review.
**Consequences:** The Android companion is not in any phase before Phase 5.

## D-014 — No browser automation of consumer AI sites

**Status:** ACCEPTED
**Context:** Spec §4.1C and §8.4 forbid DOM scraping or automation of consumer AI websites. The reference screenshots appear to show a panel driving an image-generation page in the browser. That is an unverified observation.
**Decision:** Generation uses provider APIs, mocks, or user-led manual import. No browser automation, DOM scraping, or session reuse.
**Consequences:** If a provider has no API, the product offers manual import instead.

## D-015 — Thai as default content language

**Status:** PROPOSED
**Context:** Spec §3.4, §4.1B, §16 (Thai copy quality). Target market is Thai sellers.
**Decision:** Campaign language defaults to Thai. English is optional. Language is stored per campaign and per draft. Templates have Thai and English variants where needed.
**Consequences:** Thai font handling and copy evaluation (Q-005) are part of UI and template work.

## D-016 — No billing before validation

**Status:** ACCEPTED
**Context:** Spec §14.2 and §6.4: do not build billing before product value is validated. Spec §14.4 requires a paid pilot first.
**Decision:** No billing, credits, or plan enforcement in Phases 1–3. The usage ledger from `ARCHITECTURE.md` §12 is recorded so pricing can be decided from real data.
**Consequences:** `Workspace.plan` exists as a field but has no behaviour.

## D-017 — Git branch and pull request policy

**Status:** ACCEPTED
**Context:** Session instructions specify branch `ccr-14958772-bzlatd`. The repository has no commits yet.
**Decision:** All work goes on `ccr-14958772-bzlatd`. Commits happen only when the owner asks. No pull request unless explicitly requested.
**Consequences:** Documentation changes are staged in the working tree until the owner asks for a commit.

## D-018 — Greenfield scaffold

**Status:** PROPOSED
**Context:** The repository is empty locally and on the remote. Spec §18 Step 1 asks for inspection before scaffolding.
**Decision:** Scaffold from scratch following `ARCHITECTURE.md` §2 after the owner approves D-001 to D-012. No code imported from elsewhere.
**Consequences:** The first Phase 1 commit is the tooling scaffold (roadmap step 1).

---

## Open questions

### Q-001 — Real text generation provider
**Status:** OPEN (Phase 0)
**Needed for:** Real Thai copy generation, replacing the mock.
**Information needed:** Which providers the owner can access. For each: current terms on commercial use of outputs, data retention, Thai output quality on a test set, cost per 1,000 output tokens.
**Default if no answer:** Phase 1 continues with `mock-text`. Phase 2 starts only after this is decided.

### Q-002 — Real image and video providers
**Status:** OPEN (Phase 0 / Phase 2)
**Needed for:** Image and video generation in Phase 2.
**Information needed:** API availability (not browser access), terms, cost per image and per video second, reference-image support, output rights.
**Default if no answer:** Phase 2 image/video uses user-supplied manual import only.

### Q-003 — Hosted auth provider
**Status:** OPEN (Phase 4)
**Default if no answer:** Decide when Phase 4 starts. Local single-user mode is unaffected.

### Q-004 — Object storage vendor
**Status:** OPEN (Phase 4)
**Default if no answer:** Cloudflare R2, because of egress cost, unless the owner has an existing AWS account.

### Q-005 — Thai copy evaluation set
**Status:** OPEN (before Phase 2)
**Needed for:** Measuring output quality beyond "it parses."
**Information needed:** Two or three native-speaker reviewers and 20 product briefs.
**Default if no answer:** Phase 1 uses schema validation and manual review only.

---

## Platform decisions (carried from spec §10, not yet started)

| Platform | Status | Gate |
|---|---|---|
| TikTok Content Posting API | DEFERRED to Phase 3 | App registration, `video.publish` scope, audit |
| Facebook Pages API | DEFERRED to Phase 3 | Meta app review, Page test account |
| Instagram Platform API | DEFERRED to Phase 5 | Professional-account eligibility, permissions |
| Shopee Open Platform | OPEN, not started | Confirm Thailand seller eligibility and media-publish API before any design |

No platform is shown as connected in the UI until a successful sandbox test is recorded here.
