# 04 — Data Model and API Contract

This is a logical MVP contract. Final field types and naming should be aligned with the selected ORM and shared Zod schemas.

## 1. Core entities

### User
- `id`
- `email`
- `displayName`
- `createdAt`

### Workspace
- `id`
- `name`
- `ownerUserId`
- `defaultLanguage`
- `brandVoice`
- `createdAt`, `updatedAt`

### WorkspaceMember (P1)
- `workspaceId`
- `userId`
- `role`: owner | admin | editor | reviewer | viewer

### Product
- `id`
- `workspaceId`
- `name`
- `description`
- `sourceUrl`
- `priceAmount` nullable
- `currency` nullable
- `sellingPoints` JSON array
- `targetAudience`
- `brandTone`
- `restrictedClaims` JSON array
- `status`: active | archived
- `createdAt`, `updatedAt`

### Asset
- `id`
- `workspaceId`
- `productId` nullable
- `campaignId` nullable
- `type`: image | video | audio | document
- `storageKey`
- `mimeType`
- `sizeBytes`
- `width`, `height`, `durationMs` nullable
- `thumbnailKey` nullable
- `source`: upload | generated | imported
- `provider` nullable
- `prompt` nullable
- `metadata` JSON
- `createdAt`

### Campaign
- `id`
- `workspaceId`
- `productId`
- `name`
- `contentType`
- `language`
- `platformTarget` nullable
- `tone`
- `durationSeconds` nullable
- `variantCount`
- `status`
- `createdAt`, `updatedAt`

### ContentDraft
- `id`
- `workspaceId`
- `campaignId`
- `title`
- `hook`
- `script`
- `storyboard` JSON
- `caption`
- `hashtags` JSON array
- `callToAction`
- `mediaPrompts` JSON
- `claimWarnings` JSON
- `status`: draft | in_review | approved | exported | archived
- `version`
- `createdAt`, `updatedAt`

### DraftAsset
- `draftId`
- `assetId`
- `role`: source | scene | cover | final_video | attachment
- `sortOrder`

### Job
- `id`
- `workspaceId`
- `type`: generate_brief | generate_image | generate_video | export_package
- `status`: queued | running | succeeded | failed | cancelled
- `input` JSON (no secrets)
- `output` JSON
- `errorCode` nullable
- `errorMessage` safe/redacted
- `provider` nullable
- `idempotencyKey`
- `startedAt`, `finishedAt`, `createdAt`

### UsageEvent
- `id`
- `workspaceId`
- `jobId`
- `provider`
- `model`
- `inputUnits`
- `outputUnits`
- `estimatedCost`
- `currency`
- `createdAt`

### AuditEvent
- `id`
- `workspaceId`
- `actorUserId`
- `action`
- `resourceType`
- `resourceId`
- `metadata` JSON (redacted)
- `createdAt`

## 2. Relationships

- Workspace 1—N Products, Campaigns, Assets, Jobs.
- Product 1—N Campaigns and optionally Assets.
- Campaign 1—N ContentDrafts and Assets.
- ContentDraft N—N Assets via DraftAsset.
- Job may create one or more drafts/assets.
- UsageEvent references Job.
- AuditEvent records sensitive changes.

## 3. API conventions

- Prefix: `/api/v1`
- JSON request/response.
- Authenticated routes require workspace authorization.
- Use cursor pagination for lists.
- Return stable error shape: `{ error: { code, message, requestId, details? } }`.
- All create-job endpoints accept `Idempotency-Key`.
- File upload should use signed upload URLs or a controlled multipart endpoint; never trust file extension alone.

## 4. MVP endpoints

### Workspace
- `GET /workspaces`
- `POST /workspaces`
- `GET /workspaces/:workspaceId`

### Products
- `GET /workspaces/:workspaceId/products`
- `POST /workspaces/:workspaceId/products`
- `GET /workspaces/:workspaceId/products/:productId`
- `PATCH /workspaces/:workspaceId/products/:productId`
- `POST /workspaces/:workspaceId/products/:productId/archive` and `/unarchive` (archive instead of delete; D-042)

### Assets
- `POST /workspaces/:workspaceId/assets/upload-intent`
- `POST /workspaces/:workspaceId/assets/complete-upload`
- `GET /workspaces/:workspaceId/assets`
- `GET /workspaces/:workspaceId/assets/:assetId`
- `DELETE /workspaces/:workspaceId/assets/:assetId`

(Asset and product routes are nested under the workspace; see D-042. Media bytes are read through signed `GET /media/:assetId/:variant` URLs, D-039.)

### Content
- `POST /workspaces/:workspaceId/campaigns`
- `GET /campaigns/:campaignId`
- `POST /campaigns/:campaignId/generate-brief`
- `GET /workspaces/:workspaceId/drafts` and `GET /workspaces/:workspaceId/drafts/:draftId`
- `PATCH /workspaces/:workspaceId/drafts/:draftId` (send the `version` you last saw; D-058)
- `POST /workspaces/:workspaceId/jobs/regenerate-section` (D-058; replaces `/drafts/:draftId/regenerate-section`)

### Jobs
- `GET /workspaces/:workspaceId/jobs`
- `GET /jobs/:jobId`
- `POST /jobs/:jobId/cancel`

### Export
- `POST /drafts/:draftId/export`
- `GET /exports/:exportId`

## 5. Example create-product request

```json
{
  "name": "Example product",
  "description": "User-supplied factual product description",
  "sourceUrl": "https://example.com/product",
  "sellingPoints": ["Lightweight", "Easy to clean"],
  "targetAudience": "Adults looking for everyday convenience",
  "brandTone": "Friendly, clear, trustworthy",
  "restrictedClaims": ["Do not claim medical benefits"]
}
```

## 6. Example job response

```json
{
  "id": "job_123",
  "type": "generate_brief",
  "status": "queued",
  "createdAt": "2026-11-03T12:00:00.000Z",
  "statusUrl": "/api/v1/jobs/job_123"
}
```

## 7. Authorization rules

- Every query is scoped by workspace membership.
- Never trust `workspaceId` from client without authorization check.
- Signed media URLs are short-lived.
- Deleting a product must not silently orphan assets; use archive or explicit cascade policy.
- Extension and dashboard use the same API authorization rules.

## 10. Phase 2 refinements (these supersede earlier text where they differ)

Decided after a design review; see `DECISIONS.md` D-037 to D-041.

- **Product** also has `version` (integer, starts at 1), `archivedAt`, `priceAmount` as a fixed-point decimal with a 3-letter `currency` (both set or both null), and `primaryAssetId` (nullable). `DELETE /products/:productId` is replaced by `POST /products/:productId/archive` and `POST /products/:productId/unarchive`. `PATCH` requires the current `version`; a stale version returns `409 CONFLICT`.
- **Asset** also has `status` (`pending`, `ready`, `deleted`), `deletedAt`, `updatedAt`, `originalFilename` (display only), and `sha256`. Assets are linked to products only within the same workspace (composite foreign key).
- **UploadIntent** (new): `id`, `workspaceId`, `userId`, `declaredMime`, `declaredSize`, `expiresAt`, `status` (`pending`, `received`, `completed`), `tempKey`, `assetId`. Endpoints: `POST /workspaces/:workspaceId/assets/upload-intent`, `PUT /uploads/:intentId` (signed, no bearer token), `POST /workspaces/:workspaceId/assets/complete-upload`.
- **Media**: `GET /media/:assetId/:variant` with a signed, expiring query string. Asset responses include `url` and `thumbUrl`.
- **All request bodies are strict**: unknown fields are rejected.
- **Lists** return `{ items, nextCursor }` with an opaque cursor.
- **Product routes are nested** under the workspace (decision D-042): `GET|POST /workspaces/:workspaceId/products`, `GET|PATCH /workspaces/:workspaceId/products/:productId`, and `POST .../products/:productId/archive` and `.../unarchive`. The id-only product routes in section 4 are not implemented.
