# Shopee affiliate product list with commission rates (what is known, 2026-11-05)

Question from the owner: can the app list Shopee items with their commission rate, like AutoGenX? Not built yet. This note records what was checked, so the build starts from facts.

## What exists officially

| Fact | Evidence | Confidence |
|---|---|---|
| A Shopee Affiliate **Open API** (GraphQL) has a Thailand host: `https://open-api.affiliate.shopee.co.th/graphql` | an unauthenticated POST answered HTTP 200 with `error [10020]: Invalid Authorization Header` | observed |
| The call must carry a signed `Authorization` header made from the affiliate **App ID** and **App Secret** | the 10020 error; third-party tools describe SHA256 over App ID, timestamp (Unix seconds, about 5 minutes of tolerance), payload and secret | partly third-party |
| The product query is `productOfferV2`, which returns `commissionRate` as a decimal string (`0.38` is 38%) | third-party tools built on the Brazil host (`open-api.affiliate.shopee.com.br`); not checked for Thailand | unverified for TH |
| App ID and Secret come from the **Open API** panel of an approved affiliate account; applications are reviewed by hand (one tool says 5 to 15 days) | third-party | unverified |
| A rate-limit error exists (code 10030 in one tool) | third-party | unverified |

## What this means for CreatorOps

- **Official API only.** `CLAUDE.md` forbids scraping arbitrary sites and undocumented endpoints. AutoGenX-style reading of the affiliate dashboard page is not an option here; the Open API is.
- **It needs the owner's affiliate credentials.** Without an approved Shopee Affiliate account and an App ID and Secret, nothing can be listed. This is a new gate (Q-008).
- **Secrets stay on the server.** The signing happens in the API or worker, never in the extension. The App Secret is stored encrypted like the text provider key (new credential purpose), never logged.
- **Fields to verify against the real schema before building:** product name, image URL, price (or price range), sales count, rating, shop name, `commissionRate`, `sellerCommissionRate` and `shopeeCommissionRate` (if present), product link, and the tracked **offer link** (`offerLink`).

## Proposed shape (D-081, proposed)

1. Settings: a "Shopee affiliate" box (App ID, App Secret, Check connection), same pattern as the text provider.
2. A **Find products** page in the dashboard: search by keyword and sort by commission rate or sales; each row shows image, price, sales, rating and commission. A cut-off for low commission is a filter.
3. **Create product from this item** fills a CreatorOps product (name, price, selling points left for the owner, source link = the offer link, image downloaded through the existing upload path) and goes straight to a campaign.
4. Expected commission per sale is price times rate, shown as a plain estimate with the words "before Shopee's own deductions and caps".
5. Tests against a recorded mock of the documented response shape first; the first real call needs the owner's credentials. Rate limits are respected with bounded retries.

Not decided: whether to cache results (Shopee's terms on storing offer data are unread), and whether the extension may show the list (it would call our API, not Shopee).
