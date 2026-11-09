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
| 2026-11-04 | S3.6 | First mutation run reported every mutation "killed" because the authorization harness was already red (no fixtures for the new routes), so kills proved nothing | Run the touched test files green before any mutation run; list the failing test names, not only "failed" |
| 2026-11-04 | S3.6 | A test helper `key = newKey()` default parameter: passing `undefined` to mean "no header" silently generated one | Use `null` for "absent" when a parameter has a default |
| 2026-11-04 | S3.7b | Worker built a Generate button that stayed enabled while its job ran (a second click started a second job); not in the spec, not in the mutation list | Briefs for action buttons must say when the button is disabled (pending, running, already done) and list the mutation |
| 2026-11-04 | S3.7b | The test fake needed request headers that `createFakeApi` does not pass to `intercept`; the worker added a header-recording fetch wrapper that relies on synchronous ordering | Extend the shared fake (fakeApi.ts) to hand headers to `intercept`, instead of every slice wrapping it |
| 2026-11-04 | S3.7b | Local PostgreSQL had stopped between sessions; the API suite then showed "Unhandled Error ECONNREFUSED", which looks like a code failure | Check `pnpm dev:db` and `pnpm dev:redis` are running before reading an Unhandled Error as a code problem |
| 2026-11-04 | S3.7c | Shared test setup could not live in `src/test/` (outside the allowed paths), so the worker put `draftScreenTestSetup.tsx` inside `features/drafts/` | List `apps/web/src/test/**` (or the exact helper files) in the allowed paths when a brief needs a shared test helper |
| 2026-11-04 | S3.7c | Worker changed `fakeContentApi.ts` while the brief said "extend only"; all existing tests still passed, so it was safe, but nothing proved the old behaviour was untouched | After a worker extends a shared fake, run the previous slice's tests first and read the diff of the fake |
| 2026-11-04 | S3.7c | The 25 mutation variants were all caught, but the worker ran them before a pure file split; the orchestrator re-ran 4 on the final code | Ask workers to run the mutation table last, on the final file layout |
| 2026-11-04 | S3.8 | The polling-stop rule lived inside a React hook, so inverting it survived every test; the panel's unit tests only reached the pure helpers | Extract a decision from a hook into a pure function, or add a test that drives the hook (fake timers); a mutation that survives means a missing test |
| 2026-11-04 | S3.8 | The e2e assertion "Cancelled" matched both the status pill and the status line in one row (strict mode violation) | Scope e2e assertions to the row (`filter({ hasText })` on the list item) when a state is shown twice |
| 2026-11-04 | S3.8 | A fresh container had no `node_modules`; the first typecheck failed on missing `@creatorops/ui` and `vitest`, and the extension build needed `packages/ui` built first | Setup step in the working notes: `pnpm install --frozen-lockfile`, then build `packages/ui` and `packages/contracts` before the extension checks |
| 2026-11-04 | S3.8 | A live run loaded a build without mock auth ("Sign-in is not configured yet"); `pnpm build` does not set `VITE_AUTH_MODE` | The live-run build command is in `docs/WORKING_NOTES.md` gotchas; check the panel's text before reading a failure as a code problem |

| 2026-11-04 | A3 | Two rules survived the first mutation run: a wait that did not race Cancel (the unit fakes resolved instantly) and a one-run-at-a-time guard that the UI makes unreachable | For every wait that must be cancellable, test it with a wait that never ends; test guards that the UI hides through the hook directly |
| 2026-11-05 | S5.8 | The Playwright config gave the worker no `DATA_DIR`, so the export file was written where the API could not read it; only the browser run (not unit tests) showed the download 404 | Any slice where the API serves what the worker writes needs an e2e through the real worker; shared env (`DATA_DIR`) must be set for both processes |
| 2026-11-05 | S5.8 | Two UI rules survived the first mutation run: the draft version sent (fake draft was version 1, so a hard-coded 1 passed) and the idempotency key reuse | Use a non-default value in fixtures for any field a rule copies (version, id), and test key reuse after a no-response failure and a new key after a response |
| 2026-11-07 | cost hold | Two older limit tests failed because their reported cost (0.04) was now an anomaly, so the new rule fired before the limit did | When a new rule can fire on data older tests already use, run the whole package, then change those tests' data and say why in the commit |
| 2026-11-07 | mutation runs | A mutation that left the file uncompilable printed "no tests", which looked like a result | Check that every mutation run prints a `Tests` line; use mutations that still compile (rename an event, flip a condition) |
| 2026-11-08 | Shopee photo e2e | Playwright `route.fulfill` passes Chrome's CORS check even without the header, so a "blocked CDN" test passed for the wrong reason | Model a CORS refusal with `route.abort`; say in a comment what the fake cannot show |
| 2026-11-08 | final video | Creating the job returned 500: the `jobs_target_matches_type` check lists every job type, and `assemble_video` was missing | A new job type touches three check constraints (type, error code, target) in one migration; grep `schema.ts` for the previous type's name before writing it |
| 2026-11-08 | MaxPlus | The management token saved as a network secret replaced every key sent to `api.maxplus-ai.cc`, so inference checks said "Missing API key" | Use the management token for one command only; never leave it saved as a network secret |
| 2026-11-08 | process | Four days of slices skipped `IMPLEMENTATION_STATUS.md` and this log: the MVP rule ("keep docs short") won over the skill's checklist | The checklist is now three lines at the top of the skill and in `CLAUDE.md`, and `pnpm check:docs` warns when it is skipped |
