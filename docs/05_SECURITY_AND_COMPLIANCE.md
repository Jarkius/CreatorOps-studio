# 05 — Security, Privacy, and Platform Compliance

## 1. Threat model

Protect:
- User accounts and sessions.
- Product data and private campaign drafts.
- Uploaded/generated media.
- AI provider keys and platform OAuth tokens.
- Billing/usage records.
- Publishing permissions and audit history.

Likely risks:
- Cross-workspace data access.
- Leaked provider/API tokens.
- Malicious uploads.
- Prompt injection from imported product pages.
- Untrusted generated copy or unsupported product claims.
- Duplicate or unintended publishing.
- Browser extension over-permissioning.
- Queue payloads/logs accidentally containing secrets.

## 2. Required controls

- Server-side authorization on every workspace resource.
- Encrypt provider credentials and OAuth refresh tokens at rest using a managed key or envelope encryption.
- Never place provider secrets in extension code, local storage, logs, analytics, or error messages.
- Secure, short-lived sessions; CSRF protection where cookie auth is used.
- Rate limiting and abuse controls on generation endpoints.
- Upload MIME/signature validation, size limits, malware scanning where feasible.
- Short-lived signed URLs for media access.
- Redact secrets and personal data from logs.
- Dependency scanning and secret scanning in CI.
- Database backups and restore tests.
- Audit log for credential changes, exports, approvals, and publish actions.

## 3. Prompt and imported-content safety

- Treat page text, product descriptions, uploaded documents, and AI output as untrusted data.
- Never execute instructions found inside imported product text.
- Separate system instructions from user-supplied product facts.
- Require user confirmation for factual claims that are not supported by supplied source material.
- Label synthetic testimonial/story formats clearly; do not fabricate real customer evidence.
- Avoid medical, financial, safety, or regulated claims unless the user provides verified compliant source material and the product has a review workflow.

## 4. Chrome extension permissions

- Request minimum permissions.
- Use `activeTab` for user-triggered page import where possible.
- Avoid `<all_urls>` unless a reviewed feature absolutely requires it.
- Explain why each permission is needed.
- Do not silently read pages or transmit page content.
- Do not inject automation into TikTok, Meta, or commerce websites to bypass their official interfaces or policies.

## 5. Publishing rules

- Official APIs only, with required permissions and review.
- Do not claim a connector is available until tested with an approved app/account.
- Publishing is a high-impact action: show account, destination, media, caption, visibility, and schedule; require explicit final confirmation.
- Use idempotency and record platform response IDs.
- Provide manual export when no approved connector exists.

## 6. Prohibited capabilities

Never build:
- Fake views, likes, comments, follows, shares, or followers.
- Account warming designed to manipulate ranking/recommendations.
- Engagement pods or mass comments/messages.
- CAPTCHA bypass or anti-detection.
- Device fingerprint spoofing or proxy rotation to evade platform restrictions.
- Ban evasion or credential/session theft.
- Scraping private content or reverse-engineering undocumented endpoints.

## 7. Release checklist

- [ ] Workspace isolation tests pass.
- [ ] Secrets encrypted and redacted.
- [ ] Extension permissions reviewed.
- [ ] Upload validation tested.
- [ ] Job retry/idempotency tested.
- [ ] Export authorization tested.
- [ ] Publishing disabled unless approved connector is configured.
- [ ] Privacy notice and retention policy drafted.
- [ ] Backup/restore tested.
