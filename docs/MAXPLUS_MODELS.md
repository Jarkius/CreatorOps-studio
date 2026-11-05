# MaxPlus: models by pool and prices (as seen 2026-11-05)

Companion to `MAXPLUS_PRICING.md` (the owner's price table, unverified). This file records what the gateway itself returned for key `creatorops-dev`, and what is still unknown. Refresh it with `python3 -I .claude/skills/maxplus-gateway/mp.py check --key-file <file>` after any pool change.

## Address and keys

- One base URL for every pool: `https://api.maxplus-ai.cc`. The key selects the pool; never change the address to change the pool.
- Claude Code: `ANTHROPIC_BASE_URL=https://api.maxplus-ai.cc`. Codex or OpenAI clients: `OPENAI_BASE_URL`. CreatorOps Settings (Custom): `https://api.maxplus-ai.cc/v1`; the adapter adds `/chat/completions`.
- `/v1/models` lists only the models of the key's current pool, so the list below changes when the pool changes.

## Pool "Chinese Specials" (current pool of `creatorops-dev`)

Multiplier ×0.993 (dashboard: "cheaper than Official by about 3 to 183 times"). Routes: Chat Completions, Messages, Responses. `/v1/models` returned 16 models.

| Model | Price | Tested here |
|---|---|---|
| `qwen3.8-flash` | not given | **200, Thai reply, finish=stop**, no `usage.cost` |
| `deepseek-v4.1-flash` | not given | 200; spent 16 tokens on hidden reasoning (empty reply, finish=length); reported `usage.cost` 0.00001 |
| `glm-5.3-flash` | not given | 200; same reasoning behaviour, no cost reported |
| `qwen3.8-max` | about 0.3227 THB per 1M (owner's table) | not tested |
| `deepseek-v4-pro-0813` | `deepseek-v4-pro` about 0.269 THB per 1M (owner's table) | not tested |
| `glm-5.2`, `glm-5.3`, `glm-5.3-flashx` | not given | not tested |
| `kimi-k3`, `kimi-k3.1-pro` | not given | not tested |
| `minimax-m3` | not given | not tested |
| `deepseek-v4-flash-0731`, `deepseek-v4.1-flash-1017`, `deepseek-v4-flash-vision-exp` | not given | not tested |
| `mimo-v2.6-flash`, `mimo-v2.6-pro` | not given | not tested |

Owner's table says Chinese Specials has no prompt-cache discount and a per-request minimum of about 0.0135 to 0.0403 THB. Those minimums are unverified.

## Pool "native" (earlier pool of the same key; ×5 plus a per-request minimum)

Listed on 2026-11-05 before the pool change: `claude-haiku-4-5`, `claude-haiku-4-5-20251001`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`, `claude-opus-5`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `codex-auto-review`. Chat answered 503 "disabled by the administrator" that day. Prices per pool: `MAXPLUS_PRICING.md` section 3.

## Prices: what is known and what is not

- Billing rule (owner's notes): top-up 1 THB buys 3 USD of credit; token pools cost `base USD per 1M × pool multiplier ÷ 3` THB per 1M tokens.
- The gateway's own per-model prices were **not** in the data we have: `/v1/models` returns ids only, and the Model Marketplace page was not read by the agent. To fill the "not given" cells, the owner can paste the Marketplace table (model, input and output price per 1M) into the chat, and this file is updated from it. Until then the Settings screen needs the owner's prices typed in by hand, and `usage.cost` is used when the reply reports it (deepseek did, qwen and glm did not).
- Do not treat any number here as verified until S4.0 compares it with the real balance change.

## Choosing a model for CreatorOps tests

`qwen3.8-flash` for Thai copy tests (answered correctly, finished normally). Give the deepseek and glm flash models `max_tokens` well above 16, because they use tokens for reasoning first. Data rule (D-062): development and pilot only, owner-written product text only.
