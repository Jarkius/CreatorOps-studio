# MaxPlus AI gateway: pricing notes (owner-supplied, UNVERIFIED)

Saved 2026-11-05 from the owner's message. These are claims from the gateway's own price table as the owner relayed it, not checked against any vendor or against the gateway. MaxPlus is a third-party reseller of model access. D-062 limits it to development and pilot use; D-077 explains how it shapes Phase 4. Re-read the live price page before relying on any number.

## 1. How billing works
- Top-up: 1 THB buys 3 USD of credit (a balance of $243.15 is about 81.05 THB).
- Token pools: `THB per 1M tokens = base USD price per 1M × pool multiplier ÷ 3`. Example: claude-sonnet-4-6 base $3.00 in the Claude Lite pool (1.3×) is 3 × 1.3 ÷ 3 = 1.30 THB per 1M tokens.
- Flat per-request pools charge a fixed fee per call whatever the token count.

## 2. Flat per-request pools (THB per request)
| Group | Model | THB per request |
|---|---|---|
| AI Model Request (Chinese models) | minimax-m3.1-flash-preview | 0.0135 |
| | glm-5.3-flash | 0.0161 |
| | deepseek-v4-pro-0813 | 0.0673 |
| | qwen3.8-max, glm-5.3, kimi-k3 | 0.1347 |
| Claude Request Specials | claude-haiku-4-5 | 0.0403 |
| | claude-sonnet-4-6 | 0.0807 |
| | claude-sonnet-5, claude-opus-4-8 | 0.1347 |
| | claude-opus-5, claude-fable-5 | 0.269 |

Good for long single prompts; bad for agent loops with many short calls.

## 3. Claude token pools (THB per 1M tokens, owner's table)
| Pool | Multiplier | Sonnet 4.6 | Sonnet 5 | Opus 5 | Note |
|---|---|---|---|---|---|
| Claude Lite | 1.3× | 1.30 | 0.87 | 2.17 | cheapest token pool; shared queue |
| Claude Lite Ultimate | 2.0× | 2.00 | 1.33 | 3.33 | steadier than Lite |
| Claude Native | 5.0× | 5.00 | 3.33 | 8.33 | per-request minimum (Sonnet 4.6 0.1077, Opus 5 0.3367 per request) |
| Claude Antigravity Full | 8.7× | 8.70 | - | 5.80 (opus-5-5 only) | has -thinking variants |
| Claude MAX Secret | n/a | 12.07 | 12.07 | 20.10 | small per-request minimum (0.0268 to 0.0377) |
| Claude MAX Injection | 13.0× | 13.00 | 8.67 | 21.67 | no minimum |
| Claude Cursor Full | 15.5× | 15.50 | 10.33 | 25.83 | |
| Claude MAX 20X Lite | 17.0× | 17.00 | 11.33 | 28.33 | |
| CCM1 (Max Enterprise) | 18.0× | 18.00 | 12.00 | 30.00 | |
| Claude MAX API Officials | 19.0× | 19.00 | 12.67 | 31.67 | |
| CCM2 (Max Enterprise) | 19.5× | 19.50 | 13.00 | 32.50 | |
| Claude Max 20x Pure | 24.0× | 24.00 | 16.00 | 40.00 | |
| Claude MAX Ultra 100% | 25.0× | 25.00 | 16.67 | 41.67 | |
| Claude MAX 20X Luxury | 28.0× | 28.00 | 18.67 | 46.67 | |
| Auto Pools | 1.6 to 24× | 1.6 to 24 | 1.07 to 16 | 2.67 to 40 | switches pool by itself; price can jump to 24× |

## 4. Chinese-model token pools
- Auto Pools: deepseek-v4.1-flash and glm-5.3-flash about 0.08 to 1.20 THB per 1M; kimi-k2.7-code about 0.51 to 7.60; no per-request minimum.
- China Town [No Cache] and Chinese Specials: deepseek-v4-pro about 0.269 per 1M, qwen3.8-max about 0.3227 per 1M; no prompt-cache discount; per-request minimum about 0.0135 to 0.0403.

## 5. Owner's routing notes
- Agent-style loops: start with Claude Lite (1.3×) or Lite Ultimate (2.0×); avoid Native for many small requests because of the per-request minimum.
- If Lite is rate-limited: move to MAX Injection (13×) or set CCM1 (18×) as the fallback, not Auto, so the price cannot jump to 24× unnoticed.
- One large context answered in one call: flat per-request Claude Specials.

## 6. What this means for CreatorOps (see D-077)
- Our calls are short Thai copy generations (about 1 to 3k tokens in, 1 to 2k out), so a low-multiplier token pool should beat flat fees; confirm with real usage numbers in S4.0.
- The usage ledger must store the multiplier and any per-request minimum with each event, and treat the provider-reported cost as the truth.
- Avoid Auto pools and anything with a per-request minimum. Require a spend cap for this gateway.
- Open before real use: who runs it, whether it is an authorised reseller, data retention and training, invoices and refunds, PDPA.
