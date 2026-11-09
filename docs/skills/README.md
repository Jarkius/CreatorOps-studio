# Project skills (reusable copies)

Copies of the Claude Code project skills, kept in `docs/` so they can be read, reused in another project, or restored. The live copies that Claude Code loads are in `.claude/skills/`; **edit those first, then copy here** (`cp -r .claude/skills/<name> docs/skills/`).

| Skill | What it is for |
|---|---|
| `app-dev-methodology/` | How work is done in this repo: session start, the slice loop, delegation, verification, and what to update at the end. |
| `maxplus-gateway/` | Safe use of the MaxPlus AI gateway: the helper `mp.py` (list, create with a limit, patch, reroll, delete, check, ping; secrets never printed), the key recipe, facts, and the error table. Development and pilot only (D-062). |

To reuse in another project: copy a folder into that project's `.claude/skills/`. `mp.py` needs only Python 3 and reads the management token from `MAXPLUS_MGMT_TOKEN` and the key from `--key-file` or `MAXPLUS_KEY`. Neither secret is stored in these files.
