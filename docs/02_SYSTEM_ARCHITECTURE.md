# 02 — System Architecture

## 1. Architecture decision

**Extension-first UX + backend-first execution + web dashboard.**

The Chrome extension is the compact launcher and contextual companion. The web dashboard is the full workspace. The backend owns durable state, AI orchestration, files, provider credentials, jobs, retries, and audit logs.

### Why not extension-only?

Manifest V3 service workers are ephemeral and browser permissions are intentionally constrained. Long-running AI/video jobs, secrets, durable retries, team access, and asset storage belong on the backend. An extension-only implementation would be fragile and difficult to secure.

### Why not web-only?

The reference interaction is visibly side-panel-oriented. A side panel provides quick access while the user is browsing product pages, while the dashboard handles deeper editing and organization.

## 2. Logical components

```text
┌─────────────────────┐       ┌─────────────────────┐
│ Chrome MV3 Extension│       │ Web Dashboard       │
│ Side Panel          │       │ React application   │
└──────────┬──────────┘       └──────────┬──────────┘
           └──────────────┬──────────────┘
                          │ HTTPS / Auth
                 ┌────────▼─────────┐
                 │ Backend API      │
                 │ TypeScript       │
                 │ Modular monolith │
                 └───┬───────┬──────┘
                     │       │
           ┌─────────▼─┐   ┌─▼────────────────┐
           │ PostgreSQL│   │ Redis + BullMQ   │
           │ durable   │   │ async jobs       │
           └───────────┘   └───────┬──────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ Worker processes  │
                         │ AI/provider jobs  │
                         └───┬───────────┬───┘
                             │           │
                      ┌──────▼───┐  ┌────▼────────┐
                      │ AI APIs  │  │ Object store│
                      │ adapters│  │ media/assets│
                      └──────────┘  └─────────────┘
```

## 3. Suggested stack

| Layer | MVP choice | Rationale |
|---|---|---|
| Extension | Chrome Manifest V3 + React + Vite | Side panel and fast UI iteration |
| Web | React + Vite + TypeScript | Shared UI and contracts |
| API | Node.js + TypeScript + Fastify (or NestJS if repo already uses it) | Lean modular API |
| Validation | Zod | Shared runtime schemas |
| Database | PostgreSQL | Products, campaigns, jobs, assets |
| ORM | Drizzle or Prisma; choose one, do not mix | Migrations and typed queries |
| Queue | Redis + BullMQ | Durable asynchronous work |
| Files | S3-compatible object storage; local disk for dev | Media lifecycle |
| Auth | Secure session/OIDC provider | Avoid building custom password auth prematurely |
| Tests | Vitest + API integration tests + Playwright | Unit, integration, UI |
| Monorepo | pnpm workspaces + Turborepo (optional) | Shared packages |

Claude must inspect the repository first and adapt to existing conventions rather than blindly introducing this stack.

## 4. Module boundaries

- `identity`: users, sessions, workspace membership.
- `workspace`: workspace settings and brand defaults.
- `products`: product facts and reference media.
- `content`: templates, briefs, drafts, variants, approvals.
- `assets`: upload, metadata, thumbnails, download authorization.
- `jobs`: enqueue, status, cancellation, retries, idempotency.
- `providers`: text/image/video provider interfaces and adapters.
- `publishing`: platform capabilities, account connections, publish attempts.
- `usage`: token/credit estimates, provider cost events, budgets.
- `audit`: security-relevant event records.

## 5. Asynchronous job lifecycle

`queued → running → succeeded | failed | cancelled`

- API validates request and creates a durable job record.
- Queue receives job ID; queue payload contains identifiers, not secrets.
- Worker loads authorized data, resolves provider configuration server-side, executes provider call, stores output, updates job.
- UI polls or subscribes to job status; extension closure does not stop the job.
- Retries are bounded and only apply to transient failures.
- Every job has an idempotency key and correlation ID.
- Provider timeout, rate limit, quota, invalid input, and policy rejection are distinct error classes.

## 6. Provider abstraction

Define capability interfaces, not provider-specific logic in business modules:

- `TextGenerationProvider.generateBrief(input)`
- `ImageGenerationProvider.generateImage(input)`
- `VideoGenerationProvider.generateVideo(input)`
- `SpeechProvider.synthesize(input)` (later)

Each adapter declares supported features, limits, estimated cost method if available, and retryability mapping. Provide deterministic mock adapters for local development. Do not scrape consumer AI websites or call undocumented endpoints.

## 7. Deployment topology

### Development
- Docker Compose: PostgreSQL + Redis.
- API and worker run locally.
- Local media storage.
- Mock provider by default.

### Early production
- One API service and one worker service.
- Managed PostgreSQL and Redis.
- S3-compatible object storage.
- HTTPS, secret manager, error monitoring, backups.
- Scale workers separately from API.

### Cost control
- Default to mock provider in development.
- Require user confirmation before expensive generation.
- Estimate/record cost where provider supports it.
- Per-workspace daily/monthly budgets and job caps.
- BYO key only when terms permit and key storage is encrypted server-side.
- Avoid video generation in the first milestone unless the user explicitly approves a provider and budget.

## 8. Browser extension responsibilities

Allowed:
- Side-panel UI.
- Authenticated API calls.
- Explicit user-triggered product-page import for a narrow list of supported fields.
- Display job progress and recent assets.
- Open dashboard routes.

Not allowed:
- Long-running orchestration.
- Provider API secrets.
- Broad page scraping by default.
- Hidden automated posting or UI manipulation.
- Circumventing platform restrictions.

## 9. Open architecture decisions

Record decisions in ADRs before implementation:
- Auth provider and session mechanism.
- ORM choice.
- Object storage provider.
- Whether API and worker share one deployment image.
- First paid text/image provider.
- Whether single-user local mode is a requirement.
