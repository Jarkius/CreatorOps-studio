# First Build Prompt for Claude Code

> **Status: completed 2026-11-03.** Discovery found an empty repository; the assessment, plan, and decisions are in `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, and `docs/08_PHASE_PLAN.md`. Kept for history. For the next session use `PHASE_0_BUILD_PROMPT.md`.

Read `CLAUDE.md`, `README.md`, and all files in `docs/` before coding.

## Task

Perform repository discovery only. Do not make code changes yet.

Return:
1. Existing repository structure and detected stack.
2. Existing scripts for install, dev, lint, typecheck, tests, and build.
3. Existing architecture and conventions worth preserving.
4. Missing prerequisites or risky assumptions.
5. A proposed implementation plan for Phase 0 and Phase 1 from `docs/06_IMPLEMENTATION_ROADMAP.md`.
6. The smallest first vertical slice and its acceptance tests.

If the repository is empty, propose a pnpm TypeScript monorepo with:
- `apps/extension`: Chrome Manifest V3 + React/Vite side panel.
- `apps/web`: React/Vite dashboard.
- `apps/api`: TypeScript API.
- `packages/contracts`: shared Zod schemas and API types.
- `packages/ui`: shared UI primitives.
- Docker Compose for PostgreSQL.

Do not add paid AI provider integrations, social publishing automation, broad browser permissions, or a desktop companion in this first task.

Wait for user approval before implementing.
