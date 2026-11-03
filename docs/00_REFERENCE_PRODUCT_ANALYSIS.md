# CreatorOps Studio — Product Analysis, Feasibility & System Architecture
## Build specification for Claude Code

**Document status:** Discovery-based product brief and implementation blueprint  
**Date:** 2026-11-03  
**Working name:** CreatorOps Studio (rename later)  
**Target market:** Thai solo sellers, small e-commerce teams, affiliate creators, and social-commerce agencies  
**Reference product studied:** AutoGenX META / AutoGenX ecosystem, based on four user screenshots and the public product page at https://autogention.com/

---

## 1. Executive summary

Build a desktop-first content operations tool that turns a product listing or a few product photos into a repeatable short-form content workflow:

1. Import a product and its source media.
2. Generate content concepts, scripts, captions, hashtags, shot lists, and image/video prompts.
3. Generate or import images and videos through supported AI providers.
4. Organize variants in a searchable asset library.
5. Review, edit, approve, and schedule content.
6. Publish through official platform APIs where available; otherwise export a platform-ready package and guide the user through manual publishing.
7. Track job status, publication results, and basic performance metrics.

The reference product appears to combine a Chrome side panel, AI-assisted content creation, a media selection/library view, configurable generation modes, and social publishing. The public product page describes AutoGenX META as a Chrome desktop product using Meta AI, with Podcast, Story, and series/drama modes and publishing to TikTok, Shopee, and Facebook. The page distinguishes this desktop creator from separate Android “Warm” utilities. This specification intentionally focuses on the legitimate content-production and publishing workflow—not artificial engagement, account warming, follower inflation, mass liking, or comment automation.

**Recommendation:** Feasible as a focused MVP. Do not start by attempting to reproduce every hidden feature or reverse-engineer the reference product. Build a compliant, provider-agnostic content studio with a Chrome extension shell and a local desktop companion only if needed. Make generation-provider and publishing-provider integrations replaceable modules.

### Feasibility verdict

| Area | Feasibility | Main constraint |
|---|---:|---|
| Product workspace, templates, media library | High | Normal application engineering |
| AI copy, scripts, prompt generation | High | Model cost and quality control |
| Image/video generation | Medium–High | Provider access, cost, queueing, consistency |
| Chrome side-panel UX | High | Manifest V3 extension lifecycle |
| TikTok publishing | Medium | API access, scope approval, audit and product UX rules |
| Facebook Page publishing | Medium–High | Meta app permissions and review |
| Instagram publishing (future) | Medium | Professional-account and permission requirements |
| Shopee video publishing | Uncertain until partner access is confirmed | Validate current market/partner eligibility and supported endpoints |
| Android multi-device control | Medium technically; high policy risk if misused | Keep optional, owner-controlled, and outside MVP |
| “Unlimited” AI generation at a fixed one-time price | Low | Provider costs, quotas, and changing terms make this commercially unsafe |

**Product principle:** Never promise a platform action until an official API or tested, permitted workflow supports it.

---

## 2. What the reference screenshots show

### 2.1 Directly observable

- A Chrome-like desktop browser with an extension/panel labelled **AUTOGENX META**.
- A dark blue side panel with a top toolbar and several mode tiles. The labels are partly blurred; one appears to be “Full Auto”, while other mode names are not reliably readable.
- A configurable form with dropdowns and expandable sections.
- A checklist/status area and a prominent orange action button, apparently to start a workflow.
- A media or result list containing thumbnail images, selectable rows, and text descriptions.
- A separate browser content area showing product-related images and content.
- Several Android phones mounted above/around the computer. At least one phone displays TikTok. The screenshots do not establish whether those phones are controlled by AutoGenX META, used for a separate warm-up product, or simply part of the operator’s setup.

### 2.2 Publicly described product capabilities

The public AutoGenX product page states that:

- AutoGenX META is a separate content-generation product using Meta AI.
- It includes Podcast, Story, and series/drama modes.
- The product family supports publishing to TikTok, Shopee, and Facebook.
- Pro/META creator software runs in Chrome on Windows/macOS desktop systems.
- The page describes Android phone-based TikTok Warm and Shopee Warm products as separate programs from the desktop creator.
- The page says Shopee Video posting requires Windows plus an Android phone, while TikTok/Facebook creation and posting are described separately.
- The page describes a one-time lifetime price model. Do not copy this pricing promise without a cost model and provider-contract review.

Reference: https://autogention.com/  
Relevant sections: product descriptions, system requirements, program comparison, FAQ.

### 2.3 What we must not assume

The screenshots are low-resolution live-stream captures. They do not reveal:

- The exact prompt templates or AI provider request format.
- Whether the product uses official APIs, a user-operated browser session, or another permitted integration method.
- Whether the phone rack is part of the same software.
- Whether content is generated locally, in the cloud, or by controlling an AI website.
- The exact mode names, internal data model, licensing system, or posting implementation.

**Implementation rule:** Treat these as hypotheses. Do not copy hidden code, scrape private interfaces, reuse branding, or claim compatibility until independently verified.

---

## 3. Product opportunity and positioning

### 3.1 User problem

Small sellers often have product photos but lack the time, skills, and production capacity to create a steady flow of good short-form content. They repeat manual tasks across multiple tools:

- Research product benefits and customer objections.
- Write hooks, scripts, captions, and hashtags.
- Generate lifestyle images and short videos.
- Keep a consistent character, product appearance, and brand style.
- Resize and prepare assets for each platform.
- Track which content has been drafted, approved, posted, or failed.

### 3.2 Proposed value proposition

**“One product brief → a week of reviewed, platform-ready content.”**

The differentiator should be workflow quality, Thai-language usability, repeatable brand/product context, and reliable publishing—not a claim that the software can bypass AI provider limits or platform controls.

### 3.3 Target users

1. **Solo seller / affiliate creator:** one person, a few products, wants easy templates.
2. **Small shop team:** multiple products, shared content calendar, approval process.
3. **Creator agency:** several brands/accounts, reusable templates, role-based access.
4. **Power user:** uses their own AI subscriptions/API keys and wants to orchestrate the work.

### 3.4 MVP promise

For one product, the user can create a campaign with:
- 3 content angles,
- 3 short scripts,
- 3 caption variants,
- 3 image/video briefs,
- a small set of generated/imported assets,
- a reviewable publishing package.

MVP should not promise automatic posting to every platform.

---

## 4. Product scope

### 4.1 MVP — build these first

**A. Product workspace**
- Create/edit/archive products.
- Product name, description, price (optional), selling points, target audience, tone, claims to avoid, and product URL.
- Upload multiple reference images.
- Mark a primary product image and optional reference angles.
- Store brand voice and reusable campaign defaults.

**B. Content brief generator**
- Choose a template: Product showcase, Problem/Solution, How-to, Comparison, Testimonial-style (must be clearly fictional or based on real approved evidence), FAQ, Unboxing, Story, Podcast script.
- Generate hooks, script, scene-by-scene outline, voiceover text, captions, CTA, and hashtags.
- Thai-first, with optional English.
- Allow user edits and regeneration of individual sections.
- Keep AI-generated claims grounded in supplied product facts; flag unsupported health, financial, safety, or performance claims.

**C. AI provider gateway**
- One internal interface for text generation, image generation, and video generation.
- MVP supports one text provider and one image/video provider selected after credentials and terms are validated.
- BYO API key option where provider terms allow it.
- Do not automate consumer AI websites by scraping their DOM or defeating access controls.
- If a provider has no supported API, allow manual generation/import or a user-operated browser handoff.

**D. Asset library**
- Grid/list view with image/video thumbnails.
- Filter by product, campaign, type, status, provider, and date.
- Select, preview, rename, tag, download, and attach assets to content.
- Preserve source file, generated file, prompt, provider/job metadata, and lineage.
- Store files locally for single-user mode; support object storage in hosted mode.

**E. Review and export**
- Preview a post as a platform-specific card.
- Edit caption, hashtags, CTA, cover, and media.
- Export MP4/JPEG plus caption text and posting checklist.
- Manual publish handoff when no approved connector is available.

**F. Job management**
- Queue, progress, retries, cancel, and error messages.
- Avoid blocking the UI during generation.
- Record every generation/publishing attempt.

### 4.2 Phase 2

- TikTok Content Posting API integration, subject to approval and audit.
- Facebook Page publishing through Meta APIs, subject to app review and permissions.
- Content calendar and scheduling.
- Multi-product campaigns and batch creation.
- Brand kits, reusable character/scene consistency references, prompt versioning.
- Team members, roles, approval gates.
- Basic analytics import where permitted.

### 4.3 Phase 3

- Instagram professional-account publishing, subject to supported Meta API permissions.
- Shopee integration only after verifying current official partner API capabilities, market availability, and approval.
- Optional Android device companion for legitimate device-owner tasks such as file transfer, local preview, or opening a user-confirmed publishing screen. No fake engagement or account manipulation.
- Agency workspace, client portals, billing, usage limits, and audit reporting.

### 4.4 Explicit non-goals

Do not implement:
- Fake views, likes, comments, follows, shares, or follower growth.
- “Warm-up” automation intended to manipulate recommendation algorithms.
- Engagement pods, bot personas, mass messaging, or repetitive comments.
- CAPTCHA bypass, device fingerprint spoofing, proxy rotation to evade limits, or account-ban evasion.
- Scraping private content or reverse-engineering platform endpoints.
- Automated posting to personal accounts where the official platform API does not permit it.
- Unreviewed AI claims presented as real customer testimonials.

TikTok’s Thailand seller policy explicitly describes artificial engagement and spam as prohibited practices. Keep the product focused on content creation and authorized publishing.

---

## 5. UX blueprint

### 5.1 Desktop layout

Use a web app first, with an optional Chrome extension side panel as a companion.

**Main workspace**
- Left navigation: Dashboard, Products, Campaigns, Asset Library, Calendar, Publishing, Settings.
- Main canvas: product or campaign editor.
- Right inspector: selected asset, prompt, metadata, publishing settings.

**Chrome side panel**
- Compact workflow launcher.
- Current-page import action only when the user explicitly clicks it.
- “Create from this product” and “Send to workspace”.
- Job progress and recent assets.
- Do not inject scripts into arbitrary pages by default.

### 5.2 Main workflow

1. **Select product** → product details and reference media.
2. **Choose content mode** → Showcase / Story / Podcast / FAQ / How-to.
3. **Set campaign options** → language, audience, tone, duration, aspect ratio, number of variants.
4. **Generate brief** → hooks, script, storyboard, prompts, captions.
5. **Generate/import assets** → queue and track.
6. **Review** → select assets, edit copy, validate claims and media.
7. **Prepare publishing** → choose platform, account, caption, visibility, schedule.
8. **Publish or export** → official API if available; otherwise manual handoff.
9. **Track status** → draft, queued, publishing, published, failed, needs action.

### 5.3 UI components

- Product card with primary image.
- Campaign wizard with progress steps.
- Mode tiles with clear descriptions.
- Dropdowns for language, tone, audience, duration, aspect ratio.
- Expandable advanced settings.
- Asset thumbnail grid with multi-select.
- Job progress list with retry/cancel.
- Publishing preview and explicit final confirmation.
- Activity/audit timeline.

### 5.4 UX safety

- Publishing must require a visible user confirmation.
- Show target account, platform, caption, media, and visibility before posting.
- Never silently publish generated content.
- Mark AI-generated content where required by platform rules.
- Warn if content contains unsupported factual claims, copied media, or missing rights.

---

## 6. Recommended technical architecture

### 6.1 Architecture decision

Start as a **modular monolith** with background workers. Avoid premature microservices. Use clear domain modules and provider interfaces so the system can be split later if scale requires it.

### 6.2 Logical architecture

```text
┌────────────────────────────────────────────────────────────┐
│                    Client Applications                     │
│  Web Dashboard (React)       Chrome Extension (MV3)        │
└───────────────────────┬────────────────────────────────────┘
                        │ HTTPS / typed API
┌───────────────────────▼────────────────────────────────────┐
│                    Application Backend                     │
│ Auth & Workspaces | Product/Campaign | Asset Library       │
│ Prompt/Content Orchestrator | Job API | Publishing API     │
│ Usage Metering | Audit Log | Notifications                 │
└──────────────┬─────────────────────────────┬───────────────┘
               │                             │
┌──────────────▼─────────────┐   ┌───────────▼───────────────┐
│       Job Queue            │   │       Data Layer          │
│ Redis + worker             │   │ PostgreSQL                │
│ retries / backoff          │   │ Object storage (S3/R2)    │
│ idempotency                │   │ Redis cache               │
└──────────────┬─────────────┘   └───────────────────────────┘
               │
┌──────────────▼────────────────────────────────────────────┐
│                    Provider Adapters                       │
│ Text AI | Image AI | Video AI | Speech/TTS | Moderation    │
│ TikTok API | Meta API | Shopee (only if approved)          │
│ Manual Export / User Handoff                               │
└───────────────────────────────────────────────────────────┘
```

### 6.3 Suggested stack

Prefer boring, well-supported tools. Claude Code should inspect the existing repository before choosing exact versions.

**Frontend**
- TypeScript
- React
- Vite
- Tailwind CSS
- TanStack Query
- React Hook Form + Zod
- Zustand only for lightweight client state
- Browser side panel using Chrome Manifest V3

**Backend**
- TypeScript + Node.js
- Fastify or NestJS (choose one; Fastify for a lean MVP, NestJS if the repo already uses it)
- REST API with OpenAPI
- Zod or equivalent runtime validation
- PostgreSQL
- Prisma or Drizzle (choose one; do not mix ORMs)
- Redis + BullMQ for background jobs

**Storage**
- Local development: filesystem under an application data directory.
- Hosted: S3-compatible object storage such as Cloudflare R2 or AWS S3.
- Store generated media outside PostgreSQL; store metadata and object keys in PostgreSQL.

**Desktop/local companion (optional)**
- Do not add Electron/Tauri until a real local capability is required.
- If Android device control becomes a legitimate requirement, create a separate, explicit local companion using ADB with device-owner consent and visible device selection. Do not bundle it into the core MVP.

**Testing/operations**
- Vitest
- Playwright
- Docker Compose for local PostgreSQL/Redis
- Structured logs
- Sentry or equivalent error reporting (opt-in and privacy-reviewed)
- GitHub Actions CI

### 6.4 Deployment modes

**Mode A — Local-first MVP**
- Web UI and API run locally.
- SQLite can be used only for a throwaway prototype; PostgreSQL is preferred if jobs/teams are expected.
- Local media storage.
- User manages provider credentials.
- No hosted user-data retention.

**Mode B — Hosted SaaS**
- Frontend hosted on CDN.
- API and workers on managed container platform.
- Managed PostgreSQL and Redis.
- Object storage with signed URLs.
- OAuth callback and token encryption.
- Tenant isolation and billing.

Recommendation: implement interfaces that support both, but ship local-first or a single-user hosted alpha first. Do not build billing before product value is validated.

---

## 7. Core domain model

Use UUID primary keys, UTC timestamps, soft-delete only where appropriate, and tenant/workspace scoping on every user-owned record.

### 7.1 Entities

**User**
- id
- email
- password_hash or external_auth_id
- created_at

**Workspace**
- id
- name
- owner_user_id
- plan
- created_at

**WorkspaceMember**
- workspace_id
- user_id
- role (`OWNER`, `ADMIN`, `EDITOR`, `APPROVER`, `VIEWER`)

**Product**
- id
- workspace_id
- name
- description
- product_url
- price_text
- selling_points JSON
- target_audience
- brand_voice
- restricted_claims JSON
- created_at
- updated_at

**MediaAsset**
- id
- workspace_id
- product_id nullable
- campaign_id nullable
- type (`IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`)
- source (`UPLOAD`, `AI_GENERATED`, `EXTERNAL_IMPORT`)
- object_key
- thumbnail_key
- mime_type
- size_bytes
- width / height / duration_ms
- prompt_text
- provider
- provider_job_id
- status (`UPLOADING`, `PROCESSING`, `READY`, `FAILED`, `ARCHIVED`)
- created_by
- created_at

**Campaign**
- id
- workspace_id
- product_id
- name
- content_mode (`SHOWCASE`, `STORY`, `PODCAST`, `FAQ`, `HOW_TO`, `COMPARISON`)
- language
- tone
- audience
- target_platforms JSON
- status
- created_at

**ContentDraft**
- id
- campaign_id
- title
- hook
- script
- storyboard JSON
- caption
- hashtags JSON
- cta
- ai_disclosure_required boolean
- approval_status (`DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED`)
- version
- created_at
- updated_at

**DraftAsset**
- draft_id
- asset_id
- scene_index
- role (`HERO`, `DETAIL`, `USAGE`, `COVER`, `VOICEOVER`, `FINAL`)

**GenerationJob**
- id
- workspace_id
- campaign_id
- asset_id nullable
- provider
- operation (`TEXT`, `IMAGE`, `VIDEO`, `TTS`, `MODERATION`)
- input_json
- status (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`)
- progress
- attempts
- error_code
- error_message
- provider_job_id
- started_at
- completed_at
- created_at

**SocialAccount**
- id
- workspace_id
- platform (`TIKTOK`, `FACEBOOK_PAGE`, `INSTAGRAM`, `SHOPEE`)
- external_account_id
- display_name
- encrypted_access_token
- encrypted_refresh_token
- token_expires_at
- scopes JSON
- connection_status
- created_at

**PublishJob**
- id
- workspace_id
- draft_id
- asset_id
- social_account_id
- platform
- caption_snapshot
- scheduled_at
- status (`DRAFT`, `SCHEDULED`, `AWAITING_CONFIRMATION`, `PUBLISHING`, `PUBLISHED`, `FAILED`, `NEEDS_MANUAL_ACTION`)
- external_publish_id
- error_code
- error_message
- idempotency_key
- published_at
- created_at

**AuditEvent**
- id
- workspace_id
- actor_user_id
- action
- resource_type
- resource_id
- metadata JSON
- created_at

### 7.2 Data integrity rules

- Every entity query must be scoped by workspace_id.
- Never store raw provider API keys in plaintext.
- Encrypt OAuth access/refresh tokens at rest using a managed key or envelope encryption.
- Never store platform passwords.
- Record the exact content snapshot sent to a platform.
- Use idempotency keys for generation and publishing requests.
- Preserve generated prompt and provider metadata for reproducibility.
- Do not store private platform content unless the user explicitly requests a supported import.

---

## 8. Provider abstraction contracts

Do not bind business logic directly to a specific AI vendor. Implement adapters behind interfaces.

### 8.1 Text generation

```ts
export interface TextGenerationProvider {
  id: string;
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
    maxOutputTokens?: number;
    responseSchema?: Record<string, unknown>;
  }): Promise<{
    text: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    providerRequestId?: string;
  }>;
}
```

### 8.2 Image generation

```ts
export interface ImageGenerationProvider {
  id: string;
  generate(input: {
    prompt: string;
    referenceAssetIds?: string[];
    aspectRatio: "9:16" | "4:5" | "1:1" | "16:9";
    count: number;
  }): Promise<{
    providerJobId?: string;
    assets: Array<{ url?: string; bytes?: Uint8Array; mimeType: string }>;
  }>;
}
```

### 8.3 Video generation

```ts
export interface VideoGenerationProvider {
  id: string;
  generate(input: {
    prompt: string;
    referenceAssetIds?: string[];
    durationSeconds: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
  }): Promise<{
    providerJobId: string;
    status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
    outputUrl?: string;
  }>;
  getStatus(providerJobId: string): Promise<{
    status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
    progress?: number;
    outputUrl?: string;
    error?: string;
  }>;
}
```

### 8.4 Publishing

```ts
export interface PublishingProvider {
  platform: string;
  capabilities(): Promise<{
    supportsImages: boolean;
    supportsVideos: boolean;
    supportsScheduling: boolean;
    supportsDraftUpload: boolean;
    supportedVisibilityOptions: string[];
  }>;
  publish(input: {
    accountId: string;
    mediaAssetId: string;
    caption: string;
    visibility?: string;
    scheduledAt?: string;
    userConfirmedAt: string;
    idempotencyKey: string;
  }): Promise<{
    externalId?: string;
    status: "PUBLISHED" | "PROCESSING" | "NEEDS_MANUAL_ACTION";
  }>;
  getStatus(externalId: string): Promise<{
    status: "PUBLISHED" | "PROCESSING" | "FAILED";
    error?: string;
  }>;
}
```

If a platform does not support a capability, return a typed “unsupported” result and offer manual export. Never emulate an unsupported API with hidden browser automation.

---

## 9. AI content workflow design

### 9.1 Product-to-content pipeline

```text
Product facts + reference images
          |
          v
Normalize product brief
          |
          v
Generate content angles
          |
          v
Generate hook + script + storyboard
          |
          v
Generate image/video prompts
          |
          v
User review / edit
          |
          v
AI generation provider or manual import
          |
          v
Asset library + draft assembly
          |
          v
Claims / rights / format validation
          |
          v
User approval
          |
          v
Publish API or manual export
```

### 9.2 Prompt construction

Use structured prompt templates rather than a single giant prompt. Store template version numbers.

The prompt context should include:
- Product facts supplied by the user.
- Brand voice and audience.
- Selected content mode.
- Target platform and aspect ratio.
- Scene purpose.
- Visual references explicitly selected by the user.
- Prohibited claims and style exclusions.
- Required AI disclosure metadata.

### 9.3 Content modes

**Product Showcase**
- Product hero → detail → usage → final CTA.
- Best for simple products and affiliate content.

**Story**
- Hook → situation/problem → discovery → demonstration → resolution → CTA.
- Preserve continuity between scenes.

**Podcast**
- Host intro → product problem → explanation → key benefits → CTA.
- Generate script and optional voiceover.

**FAQ / How-to**
- Question → concise answer → demonstration → caveat → CTA.
- Avoid unsupported claims.

**Series**
- Episode outline, recurring cast/visual references, scene continuity notes.
- Treat character identity references as user-controlled project assets.

### 9.4 Quality gates

Before allowing “Ready to publish”:
- Product facts are present.
- Caption is within platform limits.
- Media dimensions/duration/format are valid for the selected platform.
- Rights/consent confirmation is complete.
- AI-generated label is set when required.
- Claims checker flags unsupported claims.
- User has reviewed and approved the final preview.

---

## 10. Platform integration strategy

### 10.1 TikTok

Use the official TikTok Content Posting API only.

Important constraints from current developer documentation:
- App registration and the Content Posting API product are required.
- Direct Post requires the relevant `video.publish` scope and user authorization.
- The app must query creator information and render the required posting choices.
- Unaudited clients are restricted to private visibility until the app passes audit.
- API rate limits and platform caps must be handled.
- TikTok supports a draft-upload route as an alternative to direct publishing.

Implementation:
1. OAuth authorization.
2. Store tokens encrypted.
3. Query creator info before presenting publish settings.
4. Let user choose privacy/visibility and required settings.
5. Show explicit preview and consent.
6. Initialize upload, transfer media, poll status.
7. Save external publish ID and final state.
8. Provide manual fallback if scope/audit is unavailable.

Official references:
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content

### 10.2 Facebook

Use Meta’s official Pages APIs for Facebook Page publishing, not personal-profile automation. Expect Meta app configuration, permissions, and review. Keep Facebook Page publishing separate from Instagram publishing because their account types and permission requirements differ.

Official developer entry points:
- https://developers.facebook.com/docs/pages-api/
- https://developers.facebook.com/docs/graph-api/

### 10.3 Instagram (Phase 3)

Use the official Instagram Platform/Graph API for eligible professional accounts. Validate current account type, login method, permissions, publishing formats, media hosting requirements, and review requirements before implementation.

Official reference:
- https://developers.facebook.com/docs/instagram-platform/

### 10.4 Shopee

Do not assume Shopee Video posting is available through a generally accessible public API in every market. Before coding:
1. Register/inspect the Shopee Open Platform developer account.
2. Verify the Thailand market and seller-account eligibility.
3. Confirm the exact API product, scopes, endpoints, media constraints, and app approval.
4. Obtain sandbox credentials and run a test upload.
5. If unavailable, implement a compliant export/manual handoff instead.

Potential Open Platform entry point:
- https://open.shopee.com/

### 10.5 Platform adapter status

Represent each platform as:
- `AVAILABLE`: official API integration approved and tested.
- `BETA`: integration exists but limited to test accounts/private visibility.
- `MANUAL_ONLY`: export and user-led posting.
- `UNAVAILABLE`: not supported or not approved.

Do not show a green “connected” state when the user has only entered a username/password.

---

## 11. Chrome extension architecture

Use Manifest V3 and the official Chrome Side Panel API.

### 11.1 Extension responsibilities

- Show a compact side panel.
- Authenticate to the CreatorOps backend.
- Import a user-selected image or product URL only after explicit click.
- Send selected data to the web workspace.
- Display generation job progress and recent assets.
- Open the full dashboard for editing/review.

### 11.2 Extension components

- `manifest.json`
- `service-worker.ts`
- `sidepanel/index.html`
- `sidepanel/main.tsx`
- `content-scripts/` only for narrowly scoped, user-initiated supported pages
- `shared/messages.ts`
- `shared/api-client.ts`

### 11.3 Permissions

Request the minimum possible permissions:
- `sidePanel`
- `storage`
- `activeTab` only if needed for a user-initiated import
- `scripting` only if a documented feature truly requires it

Avoid broad `<all_urls>` host permissions. Do not read page contents in the background. Provide a clear import confirmation and show exactly what will be sent.

Chrome reference:
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel

---

## 12. Optional Android device companion

This is **not part of the MVP**.

If later justified by a legitimate user workflow, implement a separate companion that:
- Requires the user to connect and select their own device.
- Uses documented ADB capabilities for file transfer, app launch, or local preview.
- Shows connected device identifiers and an obvious stop/disconnect control.
- Does not store platform passwords.
- Does not perform likes, follows, comments, views, watch-time farming, or account warming.
- Does not evade platform security, device integrity checks, or rate limits.
- Requires explicit confirmation before any user-visible action.

Do not build a hidden multi-phone bot controller.

---

## 13. Security, privacy, and compliance

### 13.1 Security baseline

- HTTPS everywhere in hosted mode.
- Password hashing with Argon2id or a managed identity provider.
- OAuth tokens encrypted at rest.
- Provider API keys stored in OS keychain for local mode or encrypted secrets store for hosted mode.
- Workspace-level authorization on every API endpoint.
- Signed, expiring media URLs.
- File upload MIME sniffing, size limits, malware scanning where feasible.
- Rate limits and abuse detection.
- Audit log for account connection, generation, approval, and publishing.
- No secrets in browser localStorage.
- No sensitive tokens in logs or analytics.
- Dependency scanning and secret scanning in CI.

### 13.2 Privacy

- Explain which product data, images, prompts, and content are sent to each AI provider.
- Offer delete/export controls.
- Define retention windows for generated assets and job logs.
- Do not train on customer content unless separately and explicitly opted in.
- Make telemetry opt-in for the local desktop product.
- Provide a privacy notice in Thai and English before public beta.

### 13.3 Rights and content safety

- User confirms they own or have permission to use uploaded product photos, music, likenesses, and logos.
- Keep a record of user-provided source assets.
- Do not generate deceptive fake testimonials or fake before/after results.
- Clearly label synthetic media when required by platform rules.
- Add a restricted-claims policy for medical, financial, safety, and regulated product categories.

### 13.4 Platform compliance

Build only with documented, approved APIs and permitted user workflows. Platform policies change; store API version/configuration per adapter and schedule periodic compliance reviews.

TikTok Thailand policy reference on artificial engagement/spam:
https://seller-th.tiktok.com/university/essay?anchor_link=EBBF00CF&from=policy&identity=1&knowledge_id=7042369891469057&role=2

TikTok Terms:
https://www.tiktok.com/legal/page/us/terms-of-service/en

---

## 14. Cost and business feasibility

### 14.1 Cost drivers

1. Text model tokens.
2. Image generation count and resolution.
3. Video generation seconds/credits.
4. Speech synthesis.
5. Storage and media egress.
6. Queue/worker compute.
7. OAuth/API review and support operations.
8. Customer support and onboarding.

### 14.2 Pricing strategy recommendation

Do **not** sell “unlimited AI generation for life” unless the provider contract and unit economics make it genuinely sustainable.

Prefer one of:
- **BYO AI key:** customer pays the AI provider; software subscription/license covers workflow and publishing.
- **Credit bundles:** clear image/video/text credit usage with transparent cost.
- **Hybrid:** low-cost software plan plus optional prepaid generation credits.
- **Agency plan:** workspace/team fee plus metered provider usage.

### 14.3 Unit economics worksheet

For each generated deliverable, record:
- Provider
- Model
- Input/output units
- Provider-reported cost or internal cost estimate
- Retry count
- Successful output count
- Cost per accepted asset
- Gross margin by plan

Never infer provider cost from token counts alone if video/image pricing uses separate credit schedules.

### 14.4 MVP commercial validation

Interview 10–15 Thai sellers/affiliate creators. Test:
- How many posts they produce per week.
- Current tools and actual monthly spend.
- Which task is most painful: script, image, video, editing, scheduling, or posting.
- Whether they will pay for workflow software separately from AI usage.
- Whether manual export is acceptable initially.
- Which platform is essential on day one.

Run a paid pilot with 5–10 users before investing in multi-platform automation.

---

## 15. Delivery roadmap

### Phase 0 — Technical validation (3–5 days)
- Inspect repository and establish baseline.
- Verify selected text/image/video providers and their terms.
- Create one real test generation per provider.
- Confirm TikTok developer account/app requirements.
- Confirm Meta app and Page test account access.
- Contact/inspect Shopee Open Platform eligibility.
- Write a decision record for each integration.

**Exit criteria:** no critical provider or platform assumption remains untested for MVP.

### Phase 1 — Working local MVP (2–3 weeks)
- Product CRUD.
- Product image upload.
- Campaign wizard.
- Thai copy/script generation.
- Asset library.
- Job queue and status.
- Manual export package.
- Basic auth/local single-user mode.

**Exit criteria:** a user can create a product campaign, generate a complete content brief, attach assets, and export a ready-to-post package.

### Phase 2 — Generation and review (2–3 weeks)
- Image provider integration.
- Video provider integration if access/cost is viable.
- Prompt templates and versioning.
- Moderation/claims checks.
- Draft preview and approval.
- Cost metering.

**Exit criteria:** end-to-end content production is repeatable and cost per accepted asset is measurable.

### Phase 3 — Publishing alpha (3–6 weeks; approval dependent)
- TikTok API adapter.
- Facebook Page API adapter.
- OAuth account management.
- Publish queue and status polling.
- Scheduling if supported.
- Manual fallback for unsupported cases.

**Exit criteria:** approved test accounts can publish successfully, with audit logs and safe retry behavior.

### Phase 4 — SaaS/team features (4–8 weeks)
- Multi-workspace and roles.
- Team approvals.
- Content calendar.
- Billing/credits.
- Hosted object storage and deployment.
- Support/admin console.

### Phase 5 — Platform expansion
- Instagram professional accounts.
- Shopee only after official API/partner confirmation.
- Optional device companion if a validated customer need exists.

Estimates are directional for one experienced full-stack developer using AI coding assistance; approval delays and provider instability can extend the schedule.

---

## 16. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| AI provider changes UI/API or blocks automation | High | Use supported APIs; provider adapters; manual import fallback |
| TikTok app audit/permissions delay | High | Start application early; use private test mode; export fallback |
| Shopee posting unavailable to new partner | High | Validate before promising; manual export |
| AI generation costs exceed price | High | BYO key or credits; usage metering; per-plan caps |
| Product appearance drifts across generated scenes | Medium | Reference assets, prompt templates, human review |
| Platform changes break publishing | High | Versioned adapters, integration tests, kill switch |
| Account/token leakage | High | Encryption, least privilege, token rotation |
| Poor Thai copy quality | Medium | Thai-first prompt evaluation, native-speaker review |
| User expects “viral” results | Medium | Promise workflow efficiency, not algorithmic reach |
| Overbuilding Android farm control | High | Exclude from MVP and prohibit artificial engagement |

---

## 17. MVP acceptance criteria

A release candidate is acceptable when:

1. User can create a product with facts and at least three reference images.
2. User can generate at least three distinct content concepts in Thai.
3. User can edit and save hooks, scripts, storyboards, captions, and hashtags.
4. User can upload/import images and videos and view them in an asset library.
5. Generation jobs survive page refresh and show useful progress/errors.
6. User can export media plus a caption/hashtag text file.
7. No content is published without an explicit confirmation.
8. Every API call is authenticated and workspace-scoped.
9. Provider keys/tokens are not exposed in frontend bundles or logs.
10. A failed job can be retried without creating duplicate publish actions.
11. User can delete products, drafts, and assets according to retention policy.
12. A README explains local setup, environment variables, migrations, tests, and supported providers.

---

## 18. Claude Code implementation instructions

**Start by inspecting the existing repository. Do not overwrite or scaffold blindly.**

### Step 1 — Discovery
- List files and identify current framework, package manager, runtime, database, and test setup.
- Read README, package manifests, environment examples, and existing architecture.
- Identify what is already implemented.
- Report findings and propose the smallest safe implementation plan.
- Ask only for genuinely blocking choices; otherwise use the defaults in this document.

### Step 2 — Architecture decision
Create:
- `docs/PRODUCT_SPEC.md` (this document)
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `.env.example`
- `README.md` with exact setup steps

Record decisions such as:
- framework and ORM
- local vs hosted deployment mode
- selected AI provider(s)
- storage strategy
- publishing integrations available now vs manual-only

### Step 3 — Build vertical slices
Implement in this order:
1. Database schema + migrations.
2. Product CRUD API + UI.
3. Media upload and asset library.
4. Campaign/content draft model.
5. Text generation adapter with mocked provider tests.
6. Job queue and persisted job status.
7. Export package.
8. Image/video provider adapters.
9. Publishing abstractions and manual-only adapter.
10. Platform APIs only after credentials and approval are confirmed.

Each slice must include tests and a working UI path. Avoid large untested code dumps.

### Step 4 — Engineering rules
- TypeScript strict mode.
- Validate all external input.
- No `any` unless justified and isolated.
- No provider-specific logic in UI components.
- No raw SQL unless necessary and reviewed.
- No secrets in source control.
- Use migrations; never mutate production schema manually.
- Add loading, empty, error, and retry states.
- Keep functions small and modules cohesive.
- Use idempotency for background jobs and publishing.
- Do not implement undocumented endpoints or scrape consumer AI sites.
- Do not implement artificial engagement or phone-farm automation.

### Step 5 — Test strategy
- Unit tests for prompt builders, validators, and provider adapters.
- Integration tests for database, queue, and storage.
- Contract tests with mocked provider responses.
- Playwright tests for product → campaign → draft → export.
- Publishing tests must use sandbox/test accounts until platform approval.
- Add a test proving that publishing cannot happen without explicit user confirmation.

### Step 6 — Definition of done
For every feature:
- Code compiles.
- Lint and tests pass.
- UI has loading/empty/error states.
- Authorization and workspace scoping are tested.
- README/docs updated.
- No unverified platform capability is presented as supported.

### Initial Claude Code task prompt

> Read `docs/PRODUCT_SPEC.md` completely. Inspect the existing repository before making changes. First produce a concise repository assessment, architecture proposal, risks, and an ordered implementation plan. Do not start implementing until the assessment is complete. Then implement Phase 1 as small vertical slices, preserving existing conventions. Use mock adapters where real provider credentials or approvals are unavailable. Never scrape AI websites, bypass platform restrictions, automate artificial engagement, or claim an integration works without a successful test. Add tests and update documentation with each slice.

---

## 19. Reference links and research notes

**Reference product**
- AutoGenX public product page: https://autogention.com/
  - Product page describes AutoGenX META, its modes, desktop Chrome requirements, publishing claims, and distinction from separate Android warm-up tools.

**Chrome extension**
- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel

**TikTok**
- Content Posting API overview/get started: https://developers.tiktok.com/docs/en/content-posting-api-get-started
- Direct Post reference: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- Upload-to-draft guide: https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content
- Thailand artificial engagement/spam policy: https://seller-th.tiktok.com/university/essay?anchor_link=EBBF00CF&from=policy&identity=1&knowledge_id=7042369891469057&role=2

**Meta**
- Pages API: https://developers.facebook.com/docs/pages-api/
- Graph API: https://developers.facebook.com/docs/graph-api/
- Instagram Platform: https://developers.facebook.com/docs/instagram-platform/

**Shopee**
- Open Platform: https://open.shopee.com/
- Confirm current Thailand access and media publishing capabilities directly in the official developer portal before implementation.

**Research limitation:** The public product page is a vendor description, not an independent technical audit. The screenshots are observational evidence only. This document does not claim to know AutoGenX’s source code, internal architecture, private APIs, or exact implementation.

---

## 20. Final recommendation

Build **CreatorOps Studio**, not a clone of the hidden internals of AutoGenX. Reproduce the useful visible interaction pattern—a compact side panel, mode-based workflow, configurable options, asset gallery, progress checklist, and a clear action button—while creating an original product with a reliable content pipeline and transparent platform integrations.

The most defensible first release is:
- Product workspace
- Thai content/script generation
- Prompt and storyboard builder
- Asset library
- Job queue
- Human review
- Export/manual publishing

Then add official TikTok and Meta publishing after developer access and review. Treat Shopee and Android device integration as gated research items. This reduces legal, technical, and cost risk while still delivering a useful product that can be tested with real sellers.
