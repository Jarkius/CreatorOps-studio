# 03 — UX and Chrome Extension Specification

## 1. Product surfaces

### Chrome side panel (primary quick workflow)
- Header: CreatorOps Studio logo/name, workspace selector, settings.
- Primary actions: Import product details (user initiated), Create content, Open dashboard.
- Compact product summary and selected product.
- Mode tiles with short descriptions.
- Expandable generation settings.
- Start action with cost/credit estimate where possible.
- Job progress and recent output.
- Link to full editor/dashboard.

### Web dashboard (full workspace)
Navigation:
- Overview
- Products
- Campaigns
- Content drafts
- Asset library
- Calendar (P1)
- Publishing (feature-gated)
- Usage
- Settings

## 2. Key screens

### A. Product creation
Fields:
- Product name (required)
- Description
- Product URL
- Price/currency (optional)
- Selling points (repeatable)
- Target audience
- Brand tone
- Claims to avoid / evidence notes
- Reference media upload
- Primary image selection

### B. Campaign/content wizard
Steps:
1. Choose product.
2. Choose content type: Showcase, Problem/Solution, How-to, FAQ, Comparison, Unboxing, Story, Podcast.
3. Configure language, platform target, duration, tone, number of variants.
4. Review source facts and restricted claims.
5. Generate brief.
6. Edit generated sections.

### C. Content editor
Sections:
- Hook
- Voiceover/script
- Scene-by-scene storyboard
- On-screen text (editable; do not burn into media automatically)
- Caption
- Hashtags
- CTA
- Image/video prompts
- Source facts and claim warnings

Allow regenerate-one-section; do not force full regeneration when user edits a single field.

### D. Asset library
- Grid and list modes.
- Filters: product, campaign, media type, status, date, provider.
- Preview image/video.
- Metadata: source, prompt, provider, dimensions, duration, created date.
- Attach/detach asset from a draft.
- Download and delete with confirmation.

### E. Export
Create a folder/ZIP containing selected media, `caption.txt`, `hashtags.txt`, and `publishing-checklist.md`. MVP does not require automatic publishing.

## 3. Visual direction

- Professional dark navy/charcoal interface inspired by the reference workflow, but original brand and components.
- Clear high-contrast labels and accessible focus states.
- Orange or warm accent may be used for the primary action, but avoid overloading the UI.
- Use progressive disclosure: common controls visible; advanced controls collapsed.
- Job progress must be explicit; never simulate progress when provider status is unknown.
- Show meaningful error states and recovery actions.

## 4. Chrome Manifest V3 behavior

- Use `chrome.sidePanel` API.
- Request only permissions required by implemented features.
- Prefer `activeTab` and explicit click for current-page import; do not request broad host access without justification.
- Background service worker handles lightweight event routing only.
- Persist important state through backend; assume service worker can stop at any time.
- Keep extension UI thin and call backend endpoints.
- Use OAuth/secure auth flow appropriate to Chrome extensions; never embed client secrets.
- Content scripts, if added, must be narrowly scoped and documented.

## 5. Interaction states

Every async action must have:
- Idle
- Validating
- Submitting
- Queued
- Running
- Success
- Recoverable failure
- Permanent failure
- Cancelled

For generation:
- Confirm selected product and template.
- Display estimated cost or say “cost unavailable” (never invent).
- Ask confirmation before starting a potentially paid job.
- Prevent duplicate submissions through idempotency key.

## 6. Accessibility and responsive behavior

- Keyboard-accessible controls.
- Visible focus.
- Labels for all fields.
- Do not rely on color alone for job state.
- Side panel tested at narrow widths.
- Dashboard usable at laptop resolution and scales to larger screens.
