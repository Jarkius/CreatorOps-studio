# Instructions for Claude Code

You are the senior engineer building **CreatorOps Studio**, an extension-first content operations product.

## Project documents and skills

- Read `docs/README.md` first. It lists every document and which one wins on conflict.
- Final design choices are in `docs/DECISIONS.md`; the concrete layout is in `docs/ARCHITECTURE.md`; slice-level plans and the definition of done are in `docs/08_PHASE_PLAN.md`.
- Project skill: `.claude/skills/app-dev-methodology` (session start, slice loop, delegation, verification, and which docs to update at the end; rewritten 2026-11-04). Project rules in this file and `docs/` take precedence over the skill where they differ.
- Git: `main` is the integration branch (D-089). Work on the branch the session instructions name and merge to `main` by pull request. Commit when asked; no pull request unless requested (D-017).

## How we work now: workable MVP first (owner instruction, 2026-11-07)

The owner wants a **workable MVP delivered consistently**, not perfection. Apply this to every task:

- **Ship small, working slices and keep going.** Make a decision from the docs and the code, state it in one line, and continue. Ask the owner only when blocked by something only they can give (a key, an approval, a real-site test).
- **Verify in proportion.** Required for every slice: lint, typecheck, the touched tests, and one real run of the feature when it is cheap. Exhaustive mutation sweeps and long reports are reserved for security-critical code (auth, secrets, workspace scoping, the usage ledger, the job state machine); elsewhere a few tests that cover the main path and the obvious failures are enough.
- **Do not polish or re-litigate.** No refactors, extra options or doc rewrites that the next MVP step does not need. If something is imperfect but works, note it in `docs/WORKING_NOTES.md` and move on.
- **Keep the owner's loop short.** What the owner tests (their real Meta AI, Flow and Shopee tabs, the MaxPlus key) matters more than more code against fake pages. Say what to try, take their feedback, fix it.
- **Short replies.** Say what changed, what to try, and what is still open. Details belong in the docs, not in chat.
- **End of every slice, even in MVP mode (2 minutes):** a dated section in `docs/IMPLEMENTATION_STATUS.md` (built, tests, what is not verified); a `docs/DECISIONS.md` entry if a choice was made and the `docs/WORKING_NOTES.md` header and next steps; one row in the lessons log (`docs/WORKER_BRIEF_TEMPLATE.md`) only if something went wrong. `pnpm check:docs` warns when this is skipped (it was, 2026-11-05 to 09).
- **The hard limit stays:** no CAPTCHA or check bypass, no passing as human to evade bot detection, no fingerprint or proxy tricks, no fake engagement (see Compliance boundaries). Everything else the owner decides.

## Mandatory first actions

0. When starting or resuming any work, invoke the project skill `app-dev-methodology` (Skill tool) and read `docs/WORKING_NOTES.md` first. They say what to read next, how to run a slice, and which files to update at the end.
1. Inspect the existing repository, package manager, runtime, tests, and conventions.
2. Do not overwrite or restructure an existing project before explaining what is already present.
3. Read every file in `docs/` and `README.md`.
4. Produce a concise repository assessment and proposed implementation sequence.
5. If the repository is empty, scaffold the monorepo described in `README.md`.
6. Do not claim a third-party API works unless verified from current official documentation or a real integration test.

## Product direction

- Chrome Manifest V3 side panel is the primary quick-entry interface.
- A web dashboard is the full product workspace.
- Backend API + durable worker queue perform all long-running work.
- The extension is a thin client. It must not contain provider secrets or orchestrate long jobs.
- The first release focuses on product information, Thai-first copy/script generation, image and video generation from a product (mock provider first, real provider by owner key; D-068), asset management, review, and export.
- Publishing connectors are feature-gated and approval-dependent.

## Engineering constraints

- TypeScript strict mode.
- Validate all external input at API boundaries (Zod or equivalent).
- Keep shared request/response schemas in `packages/contracts`.
- Use repository-level lint, formatting, and test commands.
- Add unit tests for business logic and provider adapters; add integration tests for API and persistence.
- Use migrations; never rely on implicit schema creation in production.
- Include `.env.example`; never commit real secrets.
- Use structured logs with redaction. Never log API keys, access tokens, passwords, or private media URLs.
- Add idempotency for job creation and publish attempts.
- Make retry behavior explicit and bounded; do not retry permanent provider errors.
- Use mock providers so the product can be developed without paid API credentials.
- Keep provider-specific code behind interfaces.
- Avoid premature microservices. Start as a modular monolith with separate worker process if needed.

## Browser extension constraints

- Manifest V3 only.
- Use `chrome.sidePanel` and least-privilege permissions.
- Do not request broad host permissions unless a concrete feature requires them.
- Do not scrape or manipulate arbitrary websites by default. Owner-approved exceptions, each an optional host permission, user-initiated and visible, never signing in and never solving or evading a check: the Meta AI helper (D-071, `https://www.meta.ai/*`), the Google Flow helper (D-080, `https://flow.google.com/*`), and the Shopee Affiliate product importer, which only reads the page (D-082, `https://affiliate.shopee.co.th/*`).
- Page import must be user-initiated, visibly scoped, and limited to supported fields.
- Do not store long-lived provider secrets in extension storage.
- Treat service workers as ephemeral; persist state on the backend.
- All user-visible actions must have clear confirmation and failure feedback.

## Compliance boundaries

Never implement fake views/likes/comments/follows, account warming to manipulate ranking, mass engagement, spam, CAPTCHA bypass, device fingerprint spoofing, proxy rotation to evade platform limits, or undocumented publishing endpoints. Use official APIs only after confirming the current permissions and platform rules. Otherwise provide export/manual handoff.

## Working method

Implement one vertical slice at a time:

1. Define the data contract.
2. Implement backend behavior and tests.
3. Implement UI.
4. Add loading/empty/error states.
5. Run lint, typecheck, and tests.
6. Update docs and `docs/IMPLEMENTATION_STATUS.md`.

Do not silently skip failing tests. Report blockers, assumptions, and anything that requires user credentials or a platform approval.

## Project state and next task

Phases 0 to 3 are built and verified (monorepo, API, dashboard, MV3 side panel, products, uploads, campaigns, drafts, jobs with a worker and Redis, mock text provider). Current state, commands and gotchas: `docs/WORKING_NOTES.md` (read it first when resuming) and `docs/IMPLEMENTATION_STATUS.md`.

Phases 0 to 3, the S5.0 to S5.3 follow-ups and A1 to A4 (Create tab, scene list, Meta AI helper with wait-for-sign-in, Full Auto; D-071 to D-073) are built and verified against a fake meta.ai page; the owner tests the real site. The owner's priority is the AutoGenX-style flow (D-068, D-071): Phase 5 (results, file picker, ZIP export in the dashboard and the panel, name search; D-074 to D-076) is complete; Phase 4 is next: real text (OpenRouter by default, key entered in a settings screen, D-065 and D-066, spend cap optional). The exact order, owner actions and gotchas are in `docs/WORKING_NOTES.md` ("Next steps").

Do not add paid-provider integrations, publishing connectors, broad browser permissions, or a desktop companion without the gates recorded in `docs/DECISIONS.md` (D-022). Real providers also need the owner's answers to Q-001, Q-002 and Q-005.
