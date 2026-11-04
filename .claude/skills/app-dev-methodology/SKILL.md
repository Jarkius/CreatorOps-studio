---
name: app-dev-methodology
description: How to work on CreatorOps Studio. Use when starting or resuming a session, planning or building a slice or phase (for example "next is S3.6"), delegating to a worker agent, reviewing a worker's report, or finishing work (docs, lessons, commit). It says what to read, in what order, what to verify, and which files to update so the next agent starts ahead.
---

# CreatorOps Studio: how we work

This skill is a map, not a rulebook. The rules live in `CLAUDE.md` and `docs/`, which win over this file. If this file and a document disagree, fix this file. Every step below names the document that owns it.

## 0. Roles

| Role | Does | Must not |
|---|---|---|
| **Orchestrator** (main agent) | Plans the slice, writes security-sensitive code, runs every repo-wide check, verifies worker output, updates docs, commits | Trust a worker's report without running the checks itself |
| **Worker** (Haiku, from a brief) | Builds one mechanical slice inside the paths it was given | Commit, push, install, rebuild other packages, edit outside its paths, add features not in the spec |
| **Advisor** (read-only review) | Reviews at checkpoints: before each phase and after each security-relevant phase | Edit files |

Who writes what is decided in `docs/WORKER_BRIEF_TEMPLATE.md` section 0 and `docs/DECISIONS.md` D-031. Never delegate migrations, auth, scoping and permissions, signing, quotas, the job state machine, worker and retry logic, or anything touching secrets or storage.

## 1. Start of a session: read in this order

1. `CLAUDE.md` (rules, compliance limits, current state).
2. `docs/WORKING_NOTES.md` (where we are, commands, gotchas, next steps). Stop here if you only need to resume a slice that is already planned.
3. `docs/README.md` (index and which document wins).
4. For the slice you are about to build: its section in `docs/08_PHASE_PLAN.md`, the decisions it cites in `docs/DECISIONS.md`, then the numbered requirement documents it touches (`04` data and API, `05` security, `03` UX, `07` acceptance tests).
5. `docs/IMPLEMENTATION_STATUS.md` (what was verified, how, and what is known to be missing).
6. `git log --oneline -5` and `git status`. Do not overwrite or restructure what exists before saying what is there.

If a document is missing something you needed, that is a gap to fix at the end of the session (section 6).

## 2. Build a slice (the loop)

One vertical slice at a time. Stay inside the slice; park other ideas in the notes.

1. **Contract.** Shared request and response schemas go in `packages/contracts` (Zod). Validate all external input at the API boundary.
2. **Decide.** If the plan allowed options or reality differs from it, add a decision to `docs/DECISIONS.md` (new number, status, context, decision). Supersede accepted decisions; never edit them.
3. **Decide who builds it** (section 0). For a worker, copy the skeleton from `docs/WORKER_BRIEF_TEMPLATE.md`: allowed paths, commands it may run, mutation list, report format, the "do NOT add" line.
4. **Backend and tests.** Business logic and provider adapters get unit tests; API and persistence get integration tests against real PostgreSQL (and real Redis for the queue). Use mock providers; never add a paid provider, publishing connector or broad extension permission without the gates in D-022.
5. **UI and states.** Loading, empty and error states, with clear confirmation and failure feedback.
6. **Mutation checks.** For every security or correctness rule, break the code on purpose and confirm a test fails. Verify the break really applied (Prettier reflows code; scripted replacements can silently miss, so assert the old text exists). A mutation that survives means a missing test: add it, then re-run.
7. **Run it for real.** Start the actual processes (API, worker, Redis, database) and drive the feature over HTTP or the UI once. Unit tests did not catch a wrong entry point in S3.5; the live run did.
8. **Repo-wide checks, from the repo root:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm format:check`, plus `pnpm e2e` when the API, dashboard or extension changed. A Vitest "Unhandled Errors" line is a failure even if every test passes.
9. **Do not skip failing tests.** Report blockers, assumptions, and anything needing credentials or a platform approval (see "Open questions" in `docs/DECISIONS.md`).

Commands, environment variables and local services are in `docs/WORKING_NOTES.md` ("How to run things"). Do not copy them here.

## 3. Delegating to a worker

- Start every spec from `docs/WORKER_BRIEF_TEMPLATE.md`. List the exact files the worker may touch, including generated ones such as the OpenAPI snapshot.
- Workers run package-scoped commands only. The orchestrator runs repo-wide ones. Never rebuild `apps/api/dist` or shared packages while a worker is running e2e.
- Ask for "inputs that make a derived value empty or too long" and for any workaround to be reported under "Workarounds".
- When the report arrives: re-run the checks yourself, re-run a sample of the worker's mutation table independently, read the diff, and look for added behaviour that was not in the spec.
- Every worker failure becomes a row in the lessons log (section 6).

## 4. Rules that apply to all code (details in `CLAUDE.md` and `docs/05`)

- TypeScript strict. Migrations only; never implicit schema creation. Idempotent job creation. Bounded, explicit retries; permanent errors never retry.
- Provider code stays behind interfaces. No secrets in the extension or in logs (keys, tokens, passwords, private media URLs, Redis passwords are redacted).
- Every database query carries the workspace; every write route checks the role; tests prove a stranger gets 404 and a read-only member gets 403.
- Never build fake engagement, spam, CAPTCHA bypass, fingerprint spoofing, proxy rotation, or undocumented publishing endpoints. Do not claim a third-party API works unless verified against current official documentation or a real integration test.

## 5. Pitfalls that already cost time

Short list; the full, current set is in `docs/WORKING_NOTES.md` ("Gotchas") and the lessons log.

- Check that a file is what you think it is before a scripted edit (the API entry is `server.ts`, not `index.ts`), assert the text matched, then `git diff` it.
- Run Prettier from the repo root only (the ignore file is there).
- Shell state does not persist between commands: re-export `DATABASE_URL` and `REDIS_URL` each time.
- Probe a third-party limit against the real service before writing it into a decision (BullMQ refuses `:` in job ids).
- Test each ownership or lease check from both sides: the stale owner must stop and must not touch the new owner's row.
- Test helpers read shared counters before any `await`; tests of table-wide scans empty the table first.

## 6. End of every slice or session: update these, in this order

| File | Update when | What to write |
|---|---|---|
| `docs/IMPLEMENTATION_STATUS.md` | Always | A dated section for the slice: what was built, tests added, mutation results (including survivors and the fix), the live run, what is not done |
| `docs/DECISIONS.md` | A choice was made or a plan detail changed | New numbered entry and index row; note deviations from earlier decisions |
| `docs/WORKING_NOTES.md` | Always | Header date and phase; the slice table (done / next); test counts; new commands or gotchas; "Next steps". Keep it short; it is read first |
| `docs/WORKER_BRIEF_TEMPLATE.md` lessons log | Anything went wrong or nearly did | One row: date, slice, what went wrong, the rule added |
| This skill | A lesson applies to every future slice, or a document it points to moved | Add or tighten a line in section 5 or the loop; remove lines that are no longer true |
| Numbered docs (`01`–`08`) | Code and doc disagree | Change the doc and say why in `DECISIONS.md`, or change the code |

Then commit only verified work, with a message that says what was verified. Branch rules and no-PR-unless-asked are in `CLAUDE.md` and D-017. The stop hook asks for a commit whenever the tree is dirty: commit the verified subset and say what was left out.

## 7. Growing together (the improvement loop)

The goal is that the next agent, who remembers nothing, makes fewer mistakes than you did.

- **Write for a stranger.** `WORKING_NOTES.md` must let an agent with no context resume in five minutes: where we are, what to run, what is next, what is unverified.
- **Turn each mistake into a rule at the cheapest place that will be read.** A command that failed goes in the gotchas; a worker mistake goes in the lessons log and the brief template; a mistake that could recur in any slice goes into this skill. Prefer a test or a check in CI over a sentence.
- **Promote and prune.** When a lesson has appeared in two slices, move it from the log into the brief or this skill. When a rule is no longer true, delete it; stale rules cost trust.
- **Be honest about verification.** Say what was run and what was not (the "Not verified / known gaps" list in `WORKING_NOTES.md`). Nothing is "done" without evidence you can point to.
- **Record open questions** for the owner in `docs/DECISIONS.md` with the default that applies if nobody answers, instead of guessing silently.
- **Hand over explicitly.** The last message of a session names the next slice, what is unverified, and anything that needs the owner (credentials, platform approvals, answers to Q-001, Q-002, Q-005).

## 8. Choosing a methodology (only when planning a new phase)

The project uses incremental phases with a fixed definition of done per slice (`docs/08_PHASE_PLAN.md`), not a strict waterfall: requirements and contracts are written first and fixed in `docs/01`–`07`, delivery is a series of small verified slices, and a read-only advisor review gates each phase. Add a phase by stating its goal, its slices with an owner each (orchestrator or worker), its acceptance tests (link to `docs/07`), and the open questions it depends on. Generic Agile/Waterfall guidance is not needed beyond that.
