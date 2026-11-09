---
name: app-dev-methodology
description: How to work on CreatorOps Studio. Use when starting or resuming a session, planning or building a slice or phase, delegating to a worker agent, asking the advisor for a review, or finishing work (docs, lessons, commit). It says what to read, how to verify in proportion, and the three-line end-of-slice checklist that keeps the next agent ahead.
---

# CreatorOps Studio: how we work

A map, not a rulebook. `CLAUDE.md` and `docs/` win over this file; if they disagree, fix this file. Working style since 2026-11-07: **a workable MVP delivered consistently, not perfection** (`CLAUDE.md`).

## End of every slice: do these three, even in MVP mode (2 minutes)

1. **`docs/IMPLEMENTATION_STATUS.md`**: one dated section: what was built, tests run (counts), mutation results for security-critical code, the live run, what is **not** verified.
2. **`docs/DECISIONS.md`** if a choice was made (new number plus index row; never edit an accepted entry) and **`docs/WORKING_NOTES.md`** (header date, slice state, next steps; keep it short).
3. **Lessons log** (bottom of `docs/WORKER_BRIEF_TEMPLATE.md`): one row **only if** something went wrong or nearly did. A lesson that recurs moves into section 5 below.

Then commit only verified work. `pnpm check:docs` warns when step 1 was skipped; it also checks that `docs/skills/` still matches `.claude/skills/`. Skipping these for four days (2026-11-05 to 09) is what made the status file stale: do not trade them for speed.

## 0. Roles

| Role | Does | Must not |
|---|---|---|
| **Orchestrator** (main agent) | Plans, builds, writes anything security-sensitive, runs every repo-wide check, updates docs, commits | Trust a worker's or advisor's claim without checking the code |
| **Advisor** (the `advisor` tool; `/advisor <model>` picks the model) | Reviews before the approach is fixed and before declaring done; read-only | Edit files |
| **Worker** (Haiku, optional, from a brief) | One mechanical slice inside the paths it was given | Commit, install, rebuild other packages, add features not in the spec |

Recent slices were built by the orchestrator with advisor checkpoints, not workers. Delegate only mechanical work (`docs/WORKER_BRIEF_TEMPLATE.md`, D-031); never migrations, auth, scoping, signing, quotas, the job state machine, retries, secrets or storage.

## 1. Start of a session

1. `CLAUDE.md`, then `docs/WORKING_NOTES.md` (where we are, commands, gotchas, next steps). Enough to resume a planned slice.
2. `docs/README.md` (index), then for the slice: `docs/08_PHASE_PLAN.md`, the decisions it cites, the numbered requirement docs it touches, `docs/IMPLEMENTATION_STATUS.md`.
3. `git log --oneline -5` and `git status`. Do not overwrite or restructure what exists before saying what is there.

## 2. Build a slice

Small, working, one at a time. State the decision in one line and go on; ask the owner only when blocked by something only they can give (a key, an approval, a real-site test).

1. **Contract** in `packages/contracts` (Zod); validate all external input at the API boundary.
2. **Backend and tests**: business logic and adapters get unit tests, API and persistence get integration tests on real PostgreSQL (and Redis for the queue). Mock providers first; no paid provider, publishing connector or broad extension permission without D-022's gates.
3. **UI** with loading, empty and error states.
4. **Verify in proportion.** Always: lint, typecheck, the touched tests, one real run of the feature when cheap. **Mutation checks and live runs for security-critical code only** (auth, secrets, workspace scoping, the usage ledger and cost hold, the job state machine, ffmpeg and process handling). Break the code on purpose and confirm a test fails; confirm the mutation really applied and the run printed a `Tests` line.
5. **Advisor**: call it before committing to an approach on anything larger than a small fix, and before declaring done.
6. Repo-wide, from the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`, plus `pnpm e2e` when the API, dashboard or extension changed. A Vitest "Unhandled Errors" line is a failure.

Commands, env vars and local services are in `docs/WORKING_NOTES.md`; do not copy them here.

## 3. Hard limits (full text in `CLAUDE.md`)

TypeScript strict; migrations only; idempotent job creation; bounded retries, permanent errors never retry; provider code behind interfaces; no secrets in the extension or in logs; every query carries the workspace and every write route checks the role. Never build fake engagement, CAPTCHA or check bypass, passing as human, fingerprint or proxy tricks, undocumented publishing endpoints. Do not claim a third-party API works unless verified against current documentation or a real call.

## 4. Skills and secrets

- **`maxplus-gateway`**: use its `mp.py` for anything MaxPlus; it never prints a secret. The management token is for one command only: never leave it saved as a network secret (it replaces every key sent to that host).
- Keep `docs/skills/` identical to `.claude/skills/` (edit the live copy, then `cp -r`); `pnpm check:docs` flags drift.

## 5. Pitfalls that already cost time

- Scripted edits: assert the old text exists, then `git diff` it. Prettier reflows code, so a scripted match can silently miss. Run Prettier from the repo root only.
- A new **job type** touches three check constraints (type, error code, target) in one migration; a new **job error code** also touches `provider-core`, `retry.ts`, the contracts list and tests that pin the tuples and `MIGRATION_COUNT`. Regenerate the OpenAPI snapshot and confirm the diff only adds lines.
- When a new rule can fire on data older tests use, run the whole package and change that data deliberately.
- Playwright `route.fulfill` skips CORS; model a refusal with `route.abort`. A tab the extension creates can race request routing: open the fake site's tab first.
- Shell state does not persist: re-export `DATABASE_URL` and `REDIS_URL` each command and restart `pnpm dev:db`, `pnpm dev:redis` when services have stopped.
- A rule inside a React hook survives mutation runs unless a test drives it or it is a pure function; extract it.
- Assertions on text that appears twice in a row fail as strict-mode violations; scope them to the row.
- Test both sides of an ownership or lease check (the stale owner must stop and must not touch the new owner's row).

## 6. Keeping this useful

Write for a stranger who remembers nothing: `WORKING_NOTES.md` must let an agent resume in five minutes. Turn each mistake into a rule at the cheapest place that will be read, prefer a check in CI over a sentence, promote a lesson that recurred, delete rules that stopped being true, and say plainly what was and was not verified. End a session by naming the next slice, what is unverified, and what needs the owner (credentials, platform approvals, Q-001, Q-002, Q-005).
