# CreatorOps Studio

An extension-first content operations tool for Thai solo sellers, affiliate creators, small e-commerce teams, and agencies. It turns a product listing and a few product photos into reviewed, platform-ready short-form content.

> **Core promise:** one product brief → a week of reviewed, platform-ready content.

**Working name.** The product may be renamed later. The product is inspired by the visible workflow patterns of an existing tool, but it does not copy its branding, hidden implementation, or unverified capabilities.

## Status

Documentation is complete. **No application code exists yet.** Setup and run commands will appear here when slice S0.1 is built (see `docs/08_PHASE_PLAN.md`). Current progress is tracked in `docs/IMPLEMENTATION_STATUS.md`.

## How it works

- **Chrome side panel** (Manifest V3) is the quick-entry surface. It is a thin client.
- **Web dashboard** is the full workspace.
- **Backend API and worker** own durable state, provider calls, secrets, storage, retries, and audit.
- **Providers are replaceable.** Everything runs on mock providers until a real one passes the approval gate.

## First release scope

Product workspace → Thai-first copy and script generation → asset upload and library → job status → review and export. Publishing connectors are feature-gated and approval-dependent; manual export comes first.

## What this product will not do

No fake views, likes, comments, or follows. No account warming. No scraping or automating consumer AI sites or social platforms. No CAPTCHA, fingerprint, or proxy evasion. No device-farm control. Publishing only through official APIs after access is confirmed. See `docs/05_SECURITY_AND_COMPLIANCE.md` §6.

## Documentation

Start with `docs/README.md`, which lists every document and which one wins when two disagree.

| Document | Purpose |
|---|---|
| `CLAUDE.md` | Instructions and constraints for Claude Code |
| `docs/01_PRODUCT_REQUIREMENTS.md` | Requirements and MVP boundary |
| `docs/02_SYSTEM_ARCHITECTURE.md` | Architecture and stack |
| `docs/03_UX_AND_EXTENSION_SPEC.md` | Screens and extension behaviour |
| `docs/04_DATA_MODEL_AND_API.md` | Entities and API contract |
| `docs/05_SECURITY_AND_COMPLIANCE.md` | Security, privacy, platform rules |
| `docs/06_IMPLEMENTATION_ROADMAP.md` | Phases 0–8 |
| `docs/07_ACCEPTANCE_TESTS.md` | MVP acceptance checklist |
| `docs/08_PHASE_PLAN.md` | Phase 0–2 slices, working method, definition of done |
| `docs/ARCHITECTURE.md` | Concrete layout, conventions, module pattern |
| `docs/DECISIONS.md` | Decision log and open questions |
| `docs/IMPLEMENTATION_STATUS.md` | Live progress |
| `docs/00_REFERENCE_PRODUCT_ANALYSIS.md` | Background research |
| `docs/REFERENCE_OBSERVATIONS.md` | Unverified notes on the reference screenshots |

## Planned repository layout

```text
apps/extension     Chrome MV3 side panel
apps/web           dashboard
apps/api           HTTP API and worker entry point
packages/contracts shared Zod schemas and API types
packages/provider-core  provider interfaces, adapters, mocks
packages/ui        shared UI primitives
packages/config    shared lint, tsconfig, env helpers
infra/             docker compose and SQL migrations
```

## Project skills

`.claude/skills/app-dev-methodology` is available to Claude Code in this project. It is a general planning guide; project rules in `CLAUDE.md` and `docs/` take precedence.
