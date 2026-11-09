---
name: app-dev-methodology
description: Use at the start of any CreatorOps Studio work session, and before building, changing or finishing any feature, migration, API route, job, screen or doc. It sets the vertical-slice method (thin end-to-end slices that a user can try), the data-consistency rules for the database and files, how much to verify, how to use the advisor, and the three-line end-of-slice checklist.
version: 3.0.0
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

## 2. Build vertical slices (the fast way to deliver)

A **slice** is the thinnest change that goes from the database to something the owner can try, all in one go: contract, migration, API, worker, UI, tests, and one real run. Never build a layer on its own ("all the tables first", "all the screens first"): a half-built layer cannot be tried and hides integration bugs until late.

- **Size:** one outcome a person can see in the dashboard or side panel, reachable in a day or less. If it needs more, cut it down to the smallest version that still works end to end (for example: video joined without voice, photo saved without resizing) and list the rest as the next slice.
- **Order inside a slice:** contract (`packages/contracts`, Zod) → schema and migration → service and routes with tests → worker if it is a job → UI with loading, empty and error states → live run → the three-line checklist. Each step leaves the repo green, so the slice can stop at any point and still be committed.
- **State the decision in one line and go on.** Ask the owner only when blocked by something only they can give (a key, an approval, a real-site test).
- **Mock first, real behind the same interface**; no paid provider, publishing connector or broad extension permission without D-022's gates.
- **Verify in proportion.** Always: lint, typecheck, the touched tests, one real run when cheap. Mutation checks and live runs only for security-critical code (auth, secrets, workspace scoping, the usage ledger and cost hold, the job state machine, ffmpeg and process handling): break the code on purpose, confirm a test fails, and confirm the run printed a `Tests` line.
- **Advisor** before committing to an approach on anything bigger than a small fix, and before declaring done.
- Repo-wide from the root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`, plus `pnpm e2e` when the API, dashboard or extension changed. A Vitest "Unhandled Errors" line is a failure.

Commands, env vars and local services are in `docs/WORKING_NOTES.md`; do not copy them here.

## 2b. Data rules every slice must follow (how data stays correct)

1. **The database enforces the invariants, not only the code.** Put every rule in the schema as a `CHECK`, `UNIQUE` or `FOREIGN KEY` (the schema has about 80 checks), then prove each one by trying to break it in `apps/api/src/db/migrations.test.ts`.
2. **Workspace scoping is structural.** Every table has `workspace_id`; child tables use composite keys `(workspace_id, id)` so a link to another workspace is impossible in the database. Every query still carries the workspace, every write route checks the role, and a stranger gets 404 (tests prove both).
3. **Migrations:** change `schema.ts`, run `pnpm db:generate`, commit the generated files untouched (CI fails on drift), forward-only. A new job type touches three checks (type, error code, target); bump `MIGRATION_COUNT`.
4. **Writes that belong together share one transaction**, including the audit row. Lock the parent row (`FOR UPDATE` on the draft; the per-workspace advisory lock for the usage ledger). User-editable rows carry a `version` or section `rev` and answer 409 on a stale write. Job state writes name the status and the attempt they expect.
5. **Idempotency:** job creation is unique per workspace, user and key; replays return the first job.
6. **Files and rows:** write the file to a fresh key first, then write the row in the transaction that settles the job; on any failure delete the file; sweepers clean what a crash leaves. Assets are soft-deleted; a hard delete is refused while anything references them.
7. **Shapes and units:** JSON columns are validated with Zod when read and with a `CHECK` on their shape where the schema can; money is `numeric`, times are `timestamptz`, and leases and expiries use the database clock.
8. **Backup and retention (D-088):** files under `DATA_DIR` and every table are in `pnpm backup` automatically; `pnpm backup:check` proves a restore. A new table or file location that grows with use needs a retention decision in the slice: keep it (say so) or add it to `modules/retention` with a floor and tests that include young, wrong-status and referenced rows. Never retain-delete money records (`usage_events`) or succeeded jobs.
9. **Known gaps (do not assume they are covered):** no row-level security (scoping relies on composite keys plus the application), backups are manual and stay on the machine until the owner copies them off, files live on the local disk shared by the API and the worker (Q-004), and a call already reserved when an anomaly settles can still run.

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
- Mutation runs: compute the mutated text **before** opening the file for writing, restore from a saved copy in `finally`, `git add` new files first (a bad pattern once truncated an untracked file), and run the clean baseline after the batch; assert on before/after sets, never on global state a mutation can leave behind.
- A verifier's every check needs a test that makes it fail (a survived mutation showed a missing-file check with no test).
- `pnpm <script> -- args` passes a literal `--` to the script; strip it and test the documented command line.
- Test both sides of an ownership or lease check (the stale owner must stop and must not touch the new owner's row).

## 6. Keeping this useful

Write for a stranger who remembers nothing: `WORKING_NOTES.md` must let an agent resume in five minutes. Turn each mistake into a rule at the cheapest place that will be read, prefer a check in CI over a sentence, promote a lesson that recurred, delete rules that stopped being true, and say plainly what was and was not verified. End a session by naming the next slice, what is unverified, and what needs the owner (credentials, platform approvals, Q-001, Q-002, Q-005).
