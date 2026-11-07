# Ready check: can the owner start the real test?

**Updated:** 2026-11-07 · Branch `ccr-186e9c63-3y215n`. Short answer: **yes, start the real test; expect fixes after the first run.** Nothing here has touched the real Meta AI, Flow or Shopee pages, so only the owner's own run can confirm them.

## Verified (evidence is in `docs/IMPLEMENTATION_STATUS.md`)

| Area | How it was checked |
|---|---|
| API, worker, queue, jobs, retries, exports | unit and integration tests on real PostgreSQL and Redis; live runs |
| Dashboard (products, assets, campaigns, drafts, video prompts, Shopee marker, Settings, Costs) | web unit tests and the dashboard e2e (31 pass, 2026-11-07) |
| Side panel (Create, campaigns, scenes, video prompts, cost line) | extension unit tests (252) and the extension e2e (28 pass, 2026-11-07) |
| Meta AI helper, Flow helper, Shopee importer incl. "Load more" | **fake pages only** (e2e) |
| Real Thai text through MaxPlus (`qwen3.8-flash`) | one real run on 2026-11-05: job succeeded, cost recorded, no key in logs |
| Lint, typecheck, format | pass on every commit |

## Not verified: expect to fix these after the first run

- **The real sites.** The buttons and boxes on meta.ai, Flow and the Shopee Affiliate list were guessed from their content. The "Imagine " prefix for Meta AI images and the Shopee Next-button detection are guesses too. Fixes are small edits in `apps/extension/src/sidepanel/metaai/sites.ts`, `selectors.ts` and `shopee/page.ts`; "Copy diagnostics" says what the helper saw.
- **Flow's terms** (the page needs a sign-in; the owner has not read them) and **Shopee's terms** on automated reading (accepted by the owner in D-082).
- **Chrome behaviour:** the real toolbar click, the order of the permission prompt, and a tab opening after a wait.
- **Thai quality:** nobody has reviewed the real Thai copy (Q-005); the mock copy is placeholder text.
- **Money:** a retried generate job can pay again for variants it already made; there is no automatic stop on a cost spike; the monthly limit exists but is optional.
- **GitHub Actions** has never run. **Hosted deployment** does not exist (see the guide).

## Owner checklist (in this order)

1. Run `pnpm demo` and load `apps/extension/dist` (see `docs/USER_GUIDE.md`).
2. Try **Flow**: sign in at flow.google.com yourself, Scenes, Write video prompts, Make video in Flow.
3. Try **Shopee**: open your affiliate product list, tick Load more, Import.
4. Try **Meta AI** images if wanted.
5. For any failure press **Copy diagnostics** and send the text plus a line on what you saw.
6. Before real text: reroll the MaxPlus management token (two copies were pasted in a transcript), put the dev key in Settings, read `docs/MAXPLUS_MODELS.md`.
7. Open questions that still need you: Q-001, Q-002, Q-005 (before more real providers), Q-003, Q-004, Q-007 (before any hosted deployment).

## Hard limits that stay

No CAPTCHA or check bypass, no passing as human, no fingerprint or proxy tricks, no fake engagement. The helpers stop at a check, a slow-down notice or a sign-in page and never get past them (`CLAUDE.md`, D-082, D-083).
