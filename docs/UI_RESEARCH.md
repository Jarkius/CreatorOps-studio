# UI research for Phase 3 (2026-11-04)

Purpose: take design ideas and useful functions from the market for the dashboard (S3.7) and extension (S3.8), without copying code. Method: web search plus reading the READMEs of three open-source projects. Many web results were affiliate-style listicles, so only claims backed by a primary page (README, design-system guidance) are used below. Vendor UIs of Jasper, Copy.ai, Predis.ai and Canva were **not** inspected first-hand; treat statements about them as secondary-source and re-check before relying on them. A product named "autogenX" could not be found (closest: AutoBlogX, AutogenAI); no input from it is used.

## What was looked at

| Source | Type | License | Useful for us |
|---|---|---|---|
| Postiz (gitroomhq/postiz-app) | scheduler, Next.js + NestJS | AGPL-3.0 | Patterns only. Do not copy code (AGPL). Idea: approve posts in the calendar. |
| Mixpost (inovector/mixpost, Lite) | scheduler, Laravel | MIT | Per-network post versions, reusable templates, hashtag groups, media library, workspaces with roles. Calendar and queue come later (Phase 5+). |
| AutoShorts (alamshafil/auto-shorts) | script-to-video pipeline | MIT, archived | Shows the gap: no review UI at all (user fixes JSON by hand). Our per-section edit already goes further. Events `log`/`done` are the same idea as our job states. |
| Jasper, Copy.ai, Predis.ai (secondary sources) | commercial | n/a | Several variants per request; approval step before publishing; brand voice as a stored setting; one-prompt start from a product description. |
| Cloudscape and Telerik loading guidance | design guidance | n/a | Progress and waiting patterns below. |

## Ideas we adopt (design only)

1. **One short path from product to draft.** A product page action "Create campaign and generate" with template defaults (D-049), so the user does not face a long form. Reason from the sources: a clever AI feature that adds extra steps saves no time.
2. **Variants as tabs/cards (1 to 3), each a full draft.** Mixpost's "versions per network" and the commercial tools' multiple variations.
3. **Section cards.** Each section (title, hook, script, storyboard, caption, hashtags, call to action) is its own card with: text, an origin badge (AI or Edited, from `sectionState`), Edit, Regenerate, Copy. No tool researched exposes per-section regenerate in a documented way, so this is our own strength; keep it simple.
4. **Review workflow in the draft itself.** Status control draft, in review, approved (as in the approval step of Postiz and Predis, secondary source). Editing approved content returns it to draft (D-058); say so in the UI.
5. **Claim warnings as quiet badges.** A banner "Needs review" plus a badge on the section with the exact flagged text. None of the tools researched show content-claim warnings, so this is a differentiator; avoid alarm styling.
6. **Waiting patterns (Cloudscape, Telerik):**
   - show a job panel (drawer or strip) that stays visible while the user keeps working, with a "recent results" list;
   - a cancel control while queued or running (the API has it);
   - skeleton placeholders where the draft will appear;
   - measurable state where we have it (queued, running, attempt n of 3); a plain looping indicator otherwise;
   - failure state with the stable error message and a clear Try again (a new request with a new idempotency key).
7. **Conflict handling is explicit.** A 409 on save (stale version) opens "This draft changed. Reload / keep my text"; a regenerate refused with 409 or a job that fails `SECTION_CHANGED` says the edit was kept.
8. **Hashtag editing as chips**, copy-to-clipboard per section and for the whole draft (export is a later phase).

## Ideas we skip for now

- Token streaming with a typing cursor: our jobs are batch and D-053 chose polling, not SSE.
- Calendar, queue, scheduling, per-network versions, analytics: Phase 5 and later; publishing is gated (D-022).
- Side-by-side diff and undo history for regenerated sections: noted as a possible follow-up (D-058 says there is no history yet).
- Canva-style visual editor, video rendering, AI image layers: not in the first release.

## Open items

- Re-check Jasper, Copy.ai and Predis.ai in their own help centres or trial accounts if the owner wants a closer comparison.
- Thai UX copy (labels, error messages) needs native review (Q-005).
