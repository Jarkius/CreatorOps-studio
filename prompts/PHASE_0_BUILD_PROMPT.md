# Phase 0 Build Prompt for Claude Code

Read `CLAUDE.md`, `docs/README.md`, and every document it lists before coding. Use the `app-dev-methodology` skill for planning.

## Task

Implement **one slice at a time** from `docs/08_PHASE_PLAN.md`, starting with S0.1 (monorepo scaffold and CI baseline), then S0.2.

For each slice:

1. Re-read the slice's delivers and acceptance tests.
2. Define the contract, then backend and tests, then UI, then loading/empty/error states.
3. Run lint, typecheck, and tests; show the output.
4. Update `docs/IMPLEMENTATION_STATUS.md` (current phase, how to run, tests, decisions, next task).
5. Stop and report before starting the next slice.

## Rules

- Follow the layout and dependency rules in `docs/ARCHITECTURE.md` §2.
- Use mock providers only. No paid provider, publishing connector, broad browser permission, or desktop companion.
- No secrets in source, logs, or client bundles. Include `.env.example`.
- Do not skip failing tests. Report blockers and anything needing credentials or approvals.
- If a needed choice is not covered in `docs/DECISIONS.md`, add a decision entry rather than choosing silently.
- Commit only when asked. Work on the branch the session names; `main` is the integration branch (D-062). No pull request unless requested.
