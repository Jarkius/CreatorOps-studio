# Video and image providers: what was checked (2026-11-05)

Companion to D-080. Read from Google's own pages by a fetch agent on 2026-11-05; nothing here was tried with a real call. Re-read before relying on it: Google changes these often.

## Google Flow (consumer web tool)

| Fact | Source | Confidence |
|---|---|---|
| No public API found in the Flow Help Center pages read | support.google.com/flow (credits, availability, models) | absence only; not proof none exists |
| Terms text not readable: `flow.google.com/terms` returned a sign-in shell | fetch | the automation clauses are **unread** |
| Prohibited Use Policy bans "interference with Google's services" and "circumvention of abuse protections or safety filters" (applies to products that refer to it; not shown for Flow) | policies.google.com/terms/generative-ai/use-policy | the helper does neither |
| Non-subscribers: 50 credits a day; extras per month: AI Plus 200, Pro 1,000, Ultra $100 10,000, Ultra $200 25,000 | support.google.com/flow/answer/16526234 | read |
| Veo 3.1 Fast 20 credits (10 for Ultra), Veo 3.1 Quality 100, Gemini Omni Flash 7 to 15 credits (4 to 10 s, 720p) | same | read |
| Peak hours (about 2 to 5 pm UTC) may block non-subscribers from video | same | read |
| Ages 18+, listed countries; no prominent people, no identifiable minors; prompts best in English | support.google.com/flow/answer/16353544 | read |

Open for the owner: read Flow's terms while signed in (is automation by an extension allowed?), commercial rights to the clips, watermarks, and whether prompts and outputs are used for training.

## Gemini API video (paid, official)

| Fact | Detail | Confidence |
|---|---|---|
| Veo 3.1 preview models shut down | `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview` on 2026-10-22; migrate to `gemini-omni-1.1-flash` | read on aistudio.google.com/docs/video and /docs/omni |
| Current model | `gemini-omni-1.1-flash`, "generally available to developers on the paid tier" | read |
| Price | input $1.50 per 1M tokens; video output $17.50 per 1M; 5,792 tokens per second of 720p, about **$0.10 per second** | read from the pricing page (first 39K characters verbatim) |
| Free tier | not available | read |
| Shape | `POST https://generativelanguage.googleapis.com/v1beta/interactions` or `client.interactions.create(...)`; result is base64 video (or a file URI for larger output, then poll until ACTIVE) | partly from a summary: **verify with a real call** |
| Controls | `response_format.resolution` 360p, 720p (default), 1080p and 4k (upscaled); `aspect_ratio` 9:16 or 16:9 (default 16:9); audio by default; image-to-video, first and last frame | read |
| Length | the pages disagree (3 to 10 s clips; extend by 10 s up to 40 s total); not settled | unknown |
| Watermark | SynthID on all generated video | from a summary |
| Not available in the EEA, Switzerland, UK | editing and extending uploaded video | from a summary |

Veo 3.1 GA is named on the Gemini Enterprise Agent Platform; not checked.

## What this means for CreatorOps

- A 8-second 720p clip through the API costs about $0.80. Per campaign with four scenes: about $3.20 plus script. That cost belongs in the campaign cost panel (baht) once the API provider exists.
- The Flow helper costs nothing through our API; it spends the owner's own Flow credits (a Fast clip is 20 of the 50 daily free credits).
