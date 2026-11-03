# 06 — Implementation Roadmap

Build in small vertical slices. Do not attempt all features in one pass.

## Phase 0 — Repository discovery and decisions

Deliver:
- Repository assessment.
- Confirmed package manager/framework conventions.
- Architecture decision records for auth, ORM, storage, queue.
- `.env.example`, local dev instructions, CI baseline.

Exit criteria:
- Project builds.
- Lint/typecheck/test commands documented.
- No real credentials committed.

## Phase 1 — Extension shell + API foundation

Deliver:
- MV3 extension with side panel and original CreatorOps branding.
- React/Vite web dashboard shell.
- Backend health endpoint and authenticated API skeleton.
- Shared contracts package.
- Local Docker Compose for PostgreSQL.
- Mock auth for local development only, clearly isolated from production.

Exit criteria:
- Extension opens side panel.
- Dashboard loads.
- Both call the same API.
- Extension works after browser service worker restarts.

## Phase 2 — Workspace, products, and media

Deliver:
- Workspace and product CRUD.
- Product reference media upload.
- Asset list and primary image selection.
- Workspace authorization tests.
- Local storage adapter.

Exit criteria:
- Create product in dashboard and view it in extension.
- Upload image and preview it.
- Unauthorized workspace access is rejected.

## Phase 3 — Content generation with mock provider

Deliver:
- Content templates and generation settings.
- Brief/script/caption data contract.
- Mock text provider.
- Job table and worker/queue.
- Job status UI and regeneration of one section.

Exit criteria:
- Start job, close extension, reopen, and see correct job status.
- Failed job displays actionable error.
- Idempotency prevents duplicate job creation.

## Phase 4 — Real text provider and usage guardrails

Deliver:
- One validated text provider adapter.
- Server-side secret storage.
- Cost/usage event capture.
- Per-workspace budget cap and explicit confirmation.

Exit criteria:
- Provider key never appears in browser bundle/logs.
- Provider failures map to stable error codes.
- User can see usage and job history.

## Phase 5 — Asset library and export

Deliver:
- Asset filters and metadata.
- Attach assets to drafts.
- Export ZIP with media, caption, hashtags, checklist.
- Export permission tests.

Exit criteria:
- Export can be downloaded and opened.
- Draft remains editable after export.

## Phase 6 — Image/video provider (optional)

Only proceed after:
- Provider API and terms are verified.
- Unit economics are calculated.
- User approves a spending cap.
- Mock provider remains available.

Deliver:
- One image adapter first.
- Video adapter only if cost, latency, and output quality justify it.
- Progress and cancellation behavior.

## Phase 7 — Publishing integrations (approval-dependent)

- Validate official API and target account eligibility.
- Implement one platform at a time.
- Keep publishing behind feature flags.
- Require final user confirmation.
- Maintain manual export path.

## Phase 8 — Team and agency capabilities

- Workspace membership and roles.
- Review/approval workflow.
- Calendar.
- Analytics import where officially supported.
- Optional desktop companion only if a proven user need exists.

## Cost discipline

- No paid generation by default in local development.
- Use mocks for tests and UI demos.
- Set hard usage caps.
- Avoid fixed-price unlimited-generation promises.
- Keep text generation before image/video generation; video is likely the most expensive workflow.
