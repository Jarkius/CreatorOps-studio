---
name: maxplus-gateway
description: How to use the MaxPlus AI gateway (api.maxplus-ai.cc) for CreatorOps development and testing. Use when setting up or checking the MaxPlus provider, creating or reading dev keys, choosing a model or pool, estimating cost, or diagnosing a MaxPlus error. Development and pilot only (D-062).
version: 1.0.0
---

# MaxPlus gateway

MaxPlus is a third-party API proxy. D-062 limits it to development and pilot use: send only product text the owner wrote, never customer or personal data. Production uses the official provider chosen under Q-001.

## Two kinds of token: never mix them
- **Management token** (`ccmk-…`): manages keys only (`/v1/api-keys`). Never give it to the app, the worker, a file in the repo, a log, or chat. It is refused on inference routes.
- **Inference key** (`ccsk-…`): the only thing the app uses, pasted into Settings → Text provider. A new key's secret is shown once in the creation reply; copy it straight to Settings.
- Rotate any management token that appeared in a transcript.

## Base URL and routes
- Base: `https://api.maxplus-ai.cc/v1`. The adapter appends `/chat/completions`.
- `GET /v1/me` (free, 60 per minute per key): account, `credit_usd` balance.
- `GET /v1/models` (free): model ids. On 2026-11-05 it listed 14 models: `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-sonnet-5`, `claude-opus-4-6`/`4-7`/`4-8`, `claude-opus-5`, `claude-fable-5`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `codex-auto-review`. Re-check before relying on a name.
- `GET /v1/usage` (20 per minute per key): usage history.
- `POST /v1/api-keys` (management token): body `{"name", "limit_usd", "limit_period", "pool"}`. Used 2026-11-05 with `limit_period: "lifetime"` and `pool: "native"`; returned 201 with the id and the one-time secret.
- Keys can be listed, patched, deleted and rerolled under `/v1/api-keys`.

## Pools and price
- Each key belongs to one pool. The `native` pool (plain base URL) is the 5× Claude pool with a per-request minimum (see `docs/MAXPLUS_PRICING.md`, owner-supplied and unverified).
- Avoid Auto pools (the multiplier can jump to 24×) and any pool with a minimum that a short request pays.
- Cost rule (matches the ledger, D-077): `max(tokens × base × multiplier, minimum)`. Enter the real prices and multiplier in Settings; the provider's reported cost wins when it sends one.

## Limits and money
- Each key has `limit_usd` (dev default 100 credits). Account balance is the real cap: the account had about 2.03 USD on 2026-11-05.
- 402 means no balance or key limit reached (`PROVIDER_BUDGET`, not retried). 401 means bad key (`PROVIDER_AUTH`). 429 means rate limit and honours Retry-After. Other 4xx are request bugs.
- If the gateway reports that no pool is open, it is paused by the operator (noted 2026-11-04). Check `/v1/models` and a one-call test before a batch.

## Test procedure (costs cents)
1. `GET /v1/me` and `GET /v1/models` with the `ccsk-` key. Both must return 200. No money is spent.
2. Save the provider in Settings (Custom, `https://api.maxplus-ai.cc/v1`, model, prices, monthly limit). Press Check connection.
3. Generate once with a cheap model (`claude-haiku-4-5`). Confirm the job succeeds and Usage shows one settled call with a cost.
4. Only then run the Thai evaluation (`pnpm eval:text`, once built).

## Never
- Paste or commit a token or key. Log a request body that contains one.
- Use a management token in the worker or the extension.
- Send customer data, personal data or unpublished third-party material.
- Reuse an older project's key (the existing nine keys belong to other work and have no spend limit).

## Unverified (check before relying on it)
- Text-request rate limits per minute.
- The `usage.cost` field and whether OpenRouter-style `usage: {include: true}` affects this gateway.
- Whether `native` answers chat completions while the operator's pools are open.
