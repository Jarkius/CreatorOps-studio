# 01 — Product Requirements Document (PRD)

**Product:** CreatorOps Studio  
**Status:** MVP specification  
**Primary market:** Thai solo sellers, affiliate creators, small e-commerce teams, and creator agencies.

## 1. Product vision

Turn a product listing and a small set of product photos into a reviewable, reusable set of short-form social content—without forcing users to juggle disconnected tools.

**Core promise:** One product brief → a week of reviewed, platform-ready content.

## 2. Evidence and assumptions

The reference screenshots show a Chrome-like browser with a dark side panel, configurable modes, expandable settings, progress/checklist elements, a prominent start action, and a media/result list. Public AutoGenX marketing describes an Extension + Desktop product family. This is enough to justify an extension-first interaction model, but it does not reveal the reference product's internal implementation.

Do not copy its brand, UI assets, code, prompts, or undocumented integrations. Treat claims on vendor marketing pages as claims, not verified capabilities.

## 3. Users and jobs-to-be-done

### Persona A — Solo seller
Needs to turn product facts/photos into useful content quickly, mostly in Thai, with minimal setup.

### Persona B — Small shop team
Needs shared product facts, repeatable templates, review states, and a history of what was created.

### Persona C — Creator agency
Needs multiple brands/products, reusable tone presets, and later team permissions.

### Persona D — Technical power user
Wants to choose providers, control costs, and optionally use their own API credentials.

## 4. MVP user journey

1. Open the Chrome side panel or web dashboard.
2. Create/select a workspace.
3. Create a product with description, selling points, audience, claims to avoid, and source URL.
4. Upload product reference images.
5. Choose a content template and generation settings.
6. Generate hooks, script, storyboard, captions, CTA, and media prompts.
7. Edit and approve generated copy.
8. Upload/import generated media or request generation through an enabled provider.
9. Attach assets to a content draft.
10. Preview, export, and manually publish.
11. Track the draft/export status.

## 5. Functional requirements

### P0 — required for first usable release

- Workspace creation and basic settings.
- Product CRUD and archive.
- Product facts, selling points, audience, tone, source URL, and restricted claims.
- Multi-file media upload with file validation and progress.
- Product image gallery with primary image.
- Content template selection: Showcase, Problem/Solution, How-to, FAQ, Comparison, Unboxing, Story, Podcast.
- Thai-first copy generation; English optional.
- Generate and regenerate individual sections (hook, script, CTA, caption, hashtags, storyboard).
- User-editable content drafts.
- Job history with queued/running/succeeded/failed/cancelled states.
- Asset library with filters and preview.
- Export package: media files + caption text + hashtags + posting checklist.
- Mock text provider for development and demos.
- Cost/usage event recording when a paid provider is enabled.

### P1 — after MVP validation

- One real text provider adapter.
- One image provider adapter, only after cost and terms are checked.
- Brand voice presets and reusable prompt templates.
- Campaign grouping and multiple variants.
- Content calendar.
- Team roles and approval.
- Official TikTok/Meta publishing connector, only after access and permissions are validated.

### P2 — later

- Instagram professional-account publishing.
- Shopee connector only after confirming current official partner API and eligibility.
- Analytics import where permitted.
- Optional desktop companion for local file/device workflows.
- Agency/client workspaces and billing.

## 6. Non-functional requirements

- Responsive web dashboard; extension optimized for compact desktop side panel.
- API p95 target under 500 ms for ordinary CRUD endpoints, excluding file transfer and provider jobs.
- Provider work must be asynchronous and survive extension closure or browser restart.
- All user data scoped to workspace and authenticated user.
- Upload size/type limits configurable; validate MIME and actual file signatures.
- Audit important actions and redact secrets.
- Backups and documented restore procedure before production.
- Accessibility: keyboard navigation, visible focus, labels, contrast.
- Localization architecture supports Thai and English.

## 7. MVP success metrics

- Time from product creation to first approved content draft.
- Percentage of generated drafts edited/approved rather than abandoned.
- Successful export rate.
- Average provider cost per approved content package.
- Job failure rate and retry rate.
- Weekly active creators and repeat campaigns.
- User-reported usefulness of Thai copy.

## 8. Explicit exclusions

No fake engagement, bot activity, artificial account warming, automated follows/likes/comments, mass messaging, CAPTCHA bypass, anti-detection, proxy/fingerprint evasion, scraping private content, or undocumented platform endpoints. Do not present fictional testimonials as genuine evidence.
