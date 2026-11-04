# Worker Brief Template (for Haiku workers)

Start every worker spec from this file. Copy the sections, fill the slice-specific parts, and keep the rules. After each slice, add any new failure to "Lessons log" at the bottom (this is the continuous-improvement loop; D-031).

## 0. When to delegate

Delegate: UI screens, CRUD that repeats an existing module, pure functions with a clear spec, contracts, tests for existing behaviour.
Do not delegate (orchestrator writes it): migrations, auth, scoping and permissions, signing, quotas, job state machine, worker and retry logic, anything touching secrets or storage.

## 1. Brief skeleton

```
You are building slice <ID> in /home/user/CreatorOps-studio, in <paths> ONLY.
Do not touch any other directory. No pnpm install, no commit, no push, no rebuilding other
packages. Run only package-scoped commands: <list>.

Read first: <3-5 existing files to mirror, by path>.

Purpose: <two sentences>.

Build (numbered, each item names file, exports, behaviour and limits): ...

Do NOT add: extra validation, options, endpoints, helpers or behaviour not listed. If you think
something is missing, say so in the report; do not decide it yourself.

Mutation list (required, see section 2).
Test data rules (section 3).
Report format (section 4).
```

## 2. Mutation list (required)

For every rule the slice implements, name the one-line change that would break it, and write a test that fails when that change is made. In the brief, list the rules; in the report, list for each: rule, the mutation you tried, which test failed. A rule with no failing test is not done.
Example: rule "restricted claims match case-insensitively" -> mutation "compare without lower-casing" -> test uses an upper-case claim against lower-case text.
Tests that only confirm the happy path do not count.

## 3. Test data rules

- Valid binary fixtures only: use the shared valid PNG helper; never hand-write PNG or MP4 bytes (a bad CRC is rejected by the image library).
- Unique names for anything created in a shared database (`${Date.now()}`), and never write to the development database. End-to-end suites run on the fresh `creatorops_e2e` database.
- Test secrets and sample values must not appear inside the error messages being asserted (a value "short" collided with "too short").
- Thai samples: include combining marks (for example ที่ น้ำ) and mixed Thai and Latin text.
- No `Date.now()` or randomness in anything a test compares for equality.

## 4. Report format (required)

1. Commands run, with exact result counts (lint, typecheck, test, build, prettier). Do not report anything you did not run.
2. Files created and changed.
3. Mutation table (section 2).
4. Not built / deliberately skipped, and why.
5. Workarounds (anything bent to make a test or build pass).
6. Additions beyond the spec (anything not listed in the brief).
7. Doubts and risks.

## 5. What the orchestrator does after the report

Run the full chain itself (lint, typecheck, test, build, format:check, and e2e when UI or API changed). Read the code. Re-run the mutations. Check the "Not built", "Workarounds" and "Additions" sections first. Commit only verified work.

## 6. Good and bad test (calibration)

Good (caught a real mutation): an upper-case restricted claim against lower-case draft text; fails if matching is made case-sensitive.
Bad (survived): a restricted-claim test whose claim and text were both lower-case; it passed whether or not matching ignored case.

## Lessons log

| Date | Slice | What went wrong | Rule added |
|---|---|---|---|
| 2026-11-04 | S3.1 | Case-insensitive match had no test that could fail | Mutation list is required (section 2) |
| 2026-11-04 | S3.1 | Own test expected one warning; the word also triggered a second (unsupported) | Run the test against unmodified code first, then mutate |
| 2026-11-04 | workspace screen | Gate skipped during loading to keep old tests green; asset library left ungated; reported but easy to miss | Report section "Workarounds" is required |
| earlier | uploads | Hand-written PNG had a bad CRC | Test data rules (section 3) |
| earlier | uploads | E2E hit the 20-workspace cap on the shared database | Fresh e2e database, unique names (section 3) |
| 2026-11-04 | S3.1 | Mock added extra request checks and ranges not in the spec | "Do NOT add" line (section 1) |
| 2026-11-04 | S3.3 | New API routes change the OpenAPI snapshot, which was outside the worker's allowed paths; the worker stopped and reported instead of editing (good) | Specs for API slices must list `apps/api/src/__snapshots__/openapi.json` as an allowed file (regenerate with `vitest run app.test -u`, then check the diff has no removed lines) |
| 2026-11-04 | S3.3 | Cursor encode/decode copied from products instead of shared | Spec should say "extract and share" when a pattern is needed a second time; orchestrator to refactor before a third copy (drafts, jobs) |
| 2026-11-04 | S3.3 | Edge case (default name from one huge grapheme cluster) found by the worker but untested | Ask for "inputs that make a derived value empty or too long" in every spec |
| 2026-11-04 | S3.5 | A scripted edit to `src/index.ts` matched nothing (the API entry is `server.ts`) and failed silently; the first live run exposed it | Every scripted edit must `assert old in text` and be followed by `git diff` of the file; check what a file really is before editing it |
| 2026-11-04 | S3.5 | Mutation run: "heartbeat ignores the attempt" survived; an old worker could keep renewing a newer attempt's lease | Test every ownership check from both sides: the stale owner must stop, and must not touch the new owner's row |
| 2026-11-04 | S3.5 | Test seed helper used a shared counter after an `await`, so parallel seeds collided on a unique key | Take `const n = (counter += 1)` at the top of a helper, before any await |
| 2026-11-04 | S3.5 | Reconciler tests counted jobs left over from earlier tests in the same database | Tests of code that scans a whole table must empty it in `beforeEach` |
| 2026-11-04 | S3.5 | Prettier run inside `apps/api` reformatted the OpenAPI snapshot (the ignore file is at the repo root) | Run Prettier from the repo root only |
| 2026-11-04 | S3.5 | BullMQ rejects `:` in custom job ids, contradicting D-045 | Probe a third-party rule against the real service before writing it into a decision; record deviations in the decision file |
| 2026-11-04 | S3.5 | Shell variables and exports do not survive between tool calls; a script used an unset variable | Put exports and `set -u` variables at the top of each script; re-export `DATABASE_URL` and `REDIS_URL` in every command |

