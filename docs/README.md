# Documentation Index

Read in this order before changing code:

1. `../CLAUDE.md`
2. `01_PRODUCT_REQUIREMENTS.md`
3. `02_SYSTEM_ARCHITECTURE.md`, then `ARCHITECTURE.md`
4. `03_UX_AND_EXTENSION_SPEC.md`
5. `04_DATA_MODEL_AND_API.md`
6. `05_SECURITY_AND_COMPLIANCE.md`
7. `06_IMPLEMENTATION_ROADMAP.md`, then `08_PHASE_PLAN.md`
8. `07_ACCEPTANCE_TESTS.md`
9. `DECISIONS.md`
10. `IMPLEMENTATION_STATUS.md`
11. `WORKING_NOTES.md` (compact handoff: state, commands, gotchas; read first when resuming)
12. `UI_RESEARCH.md` (market research behind the Phase 3 UI direction, D-059)
13. `WORKER_BRIEF_TEMPLATE.md` (start every Haiku worker spec from it; lessons log at the bottom)
14. `MAXPLUS_PRICING.md` (the owner's MaxPlus gateway price notes, unverified; D-077)
15. `reference/affiliate-product-incubator.skill.md` (the owner's 5-phase affiliate framework, kept as a reference for studio templates; D-078)
16. `skills/` (reusable copies of the project skills `app-dev-methodology` and `maxplus-gateway`; the live ones are in `.claude/skills/`)

## Which document wins

1. `CLAUDE.md` compliance boundaries and `05` never yield.
2. `01`–`04`, `06`, `07` are the requirements and contracts.
3. `ARCHITECTURE.md` and `08_PHASE_PLAN.md` refine them; if they conflict, fix the refinement.
4. `DECISIONS.md` records choices where the documents allowed options.
5. `00_REFERENCE_PRODUCT_ANALYSIS.md` is background only. Where it differs from `01`–`07` (enum casing, phase numbering, role names, extension timing), `01`–`07` win.

`REFERENCE_OBSERVATIONS.md` holds unverified notes on the reference product and never overrides a requirement.

## Keeping docs current

- Update `IMPLEMENTATION_STATUS.md` at the end of every session.
- Add a decision entry to `DECISIONS.md` for any choice not already covered. Supersede, do not edit, accepted decisions.
- If implementation and a numbered doc disagree, either change the code or change the doc and say why in `DECISIONS.md`.
