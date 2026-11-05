---
name: maxplus-gateway
description: Use for anything about the MaxPlus AI gateway (api.maxplus-ai.cc) in CreatorOps - creating, listing, limiting, rerolling or deleting MaxPlus API keys with the owner's management token, checking a key's balance and models, a one-call test, choosing a model or pool, putting a key into the dashboard Settings, or explaining a MaxPlus error (401, 402, 429). Always run the helper script `mp.py` in this folder instead of hand-written curl. Development and pilot only (D-062).
version: 2.0.0
---

# MaxPlus gateway

MaxPlus is a third-party API proxy, allowed for **development and pilot only** (D-062): send only product text the owner wrote, never customer or personal data. Background: `docs/DECISIONS.md` D-062 item 2a, D-077; prices `docs/MAXPLUS_PRICING.md` (owner-supplied, unverified).

**Always use the helper:** `python3 -I .claude/skills/maxplus-gateway/mp.py <command>` (run from the repo root). It never prints a token or key, refuses unsafe actions, and writes a new secret only to a private file outside the repo. Do not hand-write curl with a secret in it.

## The two secrets (never mix them, never print them)

| Secret | Looks like | Used for | Where it may live |
|---|---|---|---|
| Management token | `ccmk-…` | creating, limiting, rerolling, deleting keys | only in the env var `MAXPLUS_MGMT_TOKEN` for one command, then gone |
| Inference key | `ccsk-…` | the app's text calls, `check`, `ping` | a private file (mode 600) outside the repo, then pasted by the owner into Settings |

Never put either one in the repo, a commit, a log, a doc, a job payload, the extension, or your reply. The app never receives a management token.

## Step 0: get the management token

1. If the owner pasted it in this conversation, pass it for one command only: `MAXPLUS_MGMT_TOKEN='<token>' python3 -I .claude/skills/maxplus-gateway/mp.py list`. Do not echo it, do not save it.
2. If it is not in the conversation, ask the owner for it. Do not search files for it unless the owner says it was pasted earlier in this same session.
3. After the work, tell the owner to **reroll the management token**, because it now sits in the transcript.

## Step 0b: find the inference key (do this before saying it is missing)

The helper reads the key from `MAXPLUS_KEY`, from the file named in `MAXPLUS_KEY_FILE`, or from `--key-file`. Check them in this order:

1. `env | grep -E '^MAXPLUS_KEY' | sed 's/=.*/=<set>/'` (names only, never values).
2. Key files left by earlier sessions. The scratchpad folder changes after every restart, so search by name and **do not cut the output** with `head` (on 2026-11-05 a `| head` hid the file, and the owner was asked for a key that was already there): `find / -xdev -name 'maxplus*.key' -not -path '/proc/*' 2>/dev/null`.
3. Only if both come back empty, ask the owner. The durable fix is for the owner to add `MAXPLUS_KEY` as an environment variable or secret in the cloud environment's settings, so every new session has it. Do not ask for the key to be pasted in chat when that option exists.

Then run `check` with that file. `ping` costs cents: run it when the owner asked to test.


All commands print `HTTP <status>` and a redacted summary. Exit code 1 means the helper refused or failed; read the `error:` line.

| Goal | Command | Needs | Cost |
|---|---|---|---|
| List keys (id, name, pool, limit, used) | `mp.py list` | management | free |
| Create a key with a limit | `mp.py create --name creatorops-dev --limit 100 --pool native --out <scratchpad>/maxplus-<name>.key` | management | free |
| Preview without creating | add `--dry-run` | none | free |
| Change a limit / turn a key off | `mp.py patch --id <id> --limit 50` or `--active false` | management | free |
| Replace a leaked key's secret | `mp.py reroll --id <id> --out <scratchpad>/maxplus-<name>.key` | management | free |
| Delete a key for good | `mp.py delete --id <id> --yes` (only when the owner asked) | management | free |
| Check balance and models | `mp.py check --key-file <file>` | inference | free |
| Prove the pool answers chat | `mp.py ping --key-file <file> --yes` (model default `claude-haiku-4-5`, 16 tokens) | inference | a few cents |
| Same, on the Anthropic-style route Claude Code uses | add `--route messages` (calls `/v1/messages`) | inference | a few cents |

Rules the helper enforces: a limit above 0 on every key; no duplicate names (use `reroll`); `--out` must be outside the repo; `delete` and `ping` need `--yes`.

`<scratchpad>` is the session scratchpad directory from the system prompt. Give the owner the **full absolute path** of the key file, never the key itself.

## Recipe: give the app a new dev key (what was done on 2026-11-05)

1. `mp.py list` and confirm no key for this project exists. Do not touch other keys (the owner's other projects use them).
2. `mp.py create --name creatorops-dev --limit 100 --period lifetime --pool native --out <scratchpad>/maxplus-creatorops-dev.key`. Expect `HTTP 201` and `secret saved … ends with XXXX`.
3. `mp.py check --key-file <that file>`. Expect `/v1/me -> 200` (read the balance) and `/v1/models -> 200`.
4. Only if the owner agrees to spend cents: `mp.py ping --key-file <that file> --yes`.
5. Tell the owner, in this order: the key name, id, pool, limit and last four characters; the file's absolute path; the account balance; to paste the key into **Settings → Text provider** (Custom, address `https://api.maxplus-ai.cc/v1`, a model from `check`, the prices and pool multiplier from MaxPlus's price page, an optional monthly limit), press **Check connection**, generate once, then delete the file; and to reroll the management token.
6. Record the key's name, id, pool and limit (never the secret) in `docs/WORKING_NOTES.md`, then commit.

## Facts (checked 2026-11-05; re-check with `check` before relying on them)

- Base URL `https://api.maxplus-ai.cc/v1`; the app's adapter adds `/chat/completions`.
- The account balance (`credit_usd`, about 2.03 USD on 2026-11-05) is the real cap until a top-up; the key limit only stops it earlier.
- The existing project key is `creatorops-dev`, id `3e07dc71f3c0ea11a414f166`, pool `native`, limit 100, lifetime.
- `/v1/models` lists only the models of the key's current pool. On pool `native` it listed: Claude Haiku 4.5, Sonnet 4.5/4.6/5, Opus 4.6/4.7/4.8/5, Fable 5, GPT 5.5, GPT 5.6 sol/terra, codex-auto-review. Cheapest for tests: `claude-haiku-4-5`.
- `native` is the 5× pool with a per-request minimum. Avoid Auto pools (multiplier can jump to 24×). The cost rule (D-077): `max(tokens × base price × multiplier, minimum)`.
- Rate limits read from the docs: `/v1/me` 60 per minute per key, `/v1/usage` 20 per minute per key.

## Errors, and what the app does with them

| HTTP | Meaning | App job code | Retried? | Tell the owner |
|---|---|---|---|---|
| 401 / 403 | key wrong, rerolled or deleted | `PROVIDER_AUTH` | no | enter the key again in Settings |
| 402 | balance empty or key limit reached | `PROVIDER_BUDGET` | no | top up, or raise the key limit with `patch` |
| 429 | rate limit | `PROVIDER_RATE_LIMITED` | yes, after Retry-After | wait |
| 5xx / network | gateway trouble, or pools closed by the operator | `PROVIDER_UNAVAILABLE` | yes, bounded | try `check`; MaxPlus closed all pools on 2026-11-04 and again on 2026-11-05: `check` was 200 while chat answered 503 "This endpoint is currently disabled by the administrator" for every model. That is MaxPlus's side, not our code. Both routes (`chat`, `messages`) failed alike while `/v1/me` showed the key on pool `native`: a 503 like this is per pool, so other users on other pools still get answers. Fix: move the key to an open pool (MaxPlus dashboard, or a new key with `create --pool <name>`), not a top-up |

## Working setup (verified 2026-11-05, later)

- **One address for every pool; the key picks the pool.** Change a key's pool in the MaxPlus dashboard; never change the address. Claude Code uses `https://api.maxplus-ai.cc` as `ANTHROPIC_BASE_URL`; our app's OpenAI-compatible adapter uses `https://api.maxplus-ai.cc/v1` (it adds `/chat/completions`). The dashboard also lists per-pool URLs; they are not needed.
- The owner moved `creatorops-dev` to pool **Chinese Specials** (×0.993; Chat Completions, Messages and Responses).
- `qwen3.8-flash`: 200, `finish=stop`, Thai reply, `usage.cost` not reported. `deepseek-v4.1-flash` and `glm-5.3-flash` spend 16 tokens on hidden reasoning (`finish=length`, empty reply), so give them a larger `max_tokens`; deepseek reported `usage.cost` 0.00001.
- Balance 301.93 USD after the owner's top-up; the key limit (100 USD lifetime) is now the real cap.
- These are Chinese model providers behind a third-party proxy: development and pilot only, owner-written product text only (D-062).

## Unverified (say so if asked)

- Text-request rate limits per minute; whether replies carry `usage.cost` (if not, the ledger uses the owner's prices); whether `native` answers chat while the operator's pools are open (run `ping` to find out).
