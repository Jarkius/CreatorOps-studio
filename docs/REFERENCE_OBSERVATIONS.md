# Reference Observations — AutoGenX META screenshots

**Date recorded:** 2026-11-03
**Status:** Unverified observations from screenshots and a public live stream. Not a technical audit. Do not copy code, layouts verbatim, branding, or private interfaces.

---

## Frames reviewed

| Frame (stream clock) | What is visible | Confidence |
|---|---|---|
| 21:30 | Rack of about eight Android phones on mounted arms. Several home screens show TikTok and Shopee icons. Laptop shows the AutoGenX META panel with TikTok and Shopee tabs, a product photo, and settings for 9:16 video and 10-second duration. A "Gallery" view appears on one phone. | High for what is shown; unknown whether phones are automated |
| 21:31 | Browser window shows a grid of AI-generated portrait and lifestyle images. A small "AutoGenX Meta" popup shows a progress bar labelled as an image-generation step. | Medium: the generation page is not identified |
| 21:32 | AutoGenX META side panel with a "Full Auto" mode tile, dropdown form, a checklist with three items, and an orange action button. Phone above shows TikTok and Shopee icons. | High for panel layout |

Earlier screenshots (from the owner's original set) show the same panel, a dark blue theme, mode tiles, and a result list with thumbnails.

## What this suggests about the reference product

- The panel is a Chrome-based tool with a mode-based workflow, a checklist, and a single primary action.
- Platform targets shown in the UI include TikTok and Shopee, consistent with the public product page.
- Image generation appears to happen in a browser page. The exact provider, and whether it is an official API, is unknown.
- A multi-phone rack is visible. Its purpose is not established by the frames.

## What we will not infer or copy

- That the phones are automated, or that the rack is part of the same software.
- That the browser step drives a consumer AI website. Our spec forbids that approach regardless (spec §4.1C; decision D-014).
- Exact mode names, prompts, layouts, colours, or assets.
- Any engagement or "warm-up" function. These are excluded (spec §4.4; decision D-013).

## Implications for CreatorOps Studio

| Observation | Our response |
|---|---|
| Side-panel workflow with modes and a checklist | Build an original thin side panel in Phase 1 (D-019). Do not copy the layout, wording, or assets. |
| TikTok and Shopee targets | Publishing is Phase 7 and approval-gated (D-010). Shopee is OPEN. |
| Browser-driven image generation | Use provider APIs or manual import only (D-014). Q-002 decides providers. |
| Phone rack and TikTok/Shopee on devices | Excluded (D-013). No device-control code. |
| Live-stream chat asks whether a computer is needed and how to enable "developer mode" | Signals that the product is marketed around automation. Our marketing must describe the workflow honestly and avoid automation claims. |

## Open verification

To move any observation from "unverified" to "verified", the owner would need to test the product themselves in an environment they control. We do not install or run the reference product as part of this project.
