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
- `GET /products/:productId`
- `PATCH /products/:productId`
- `DELETE /products/:productId` (soft delete/archive preferred)

### Assets
- `POST /workspaces/:workspaceId/assets/upload-intent`
- `POST /workspaces/:workspaceId/assets/complete-upload`
- `GET /workspaces/:workspaceId/assets`
- `GET /assets/:assetId`
- `DELETE /assets/:assetId`

### Content
- `POST /workspaces/:workspaceId/campaigns`
- `GET /campaigns/:campaignId`
- `POST /campaigns/:campaignId/generate-brief`
- `GET /drafts/:draftId`
- `PATCH /drafts/:draftId`
- `POST /drafts/:draftId/regenerate-section`

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
