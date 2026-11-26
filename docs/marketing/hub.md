# VYRA Marketing hub

An owner-only section of the VYRA admin to plan campaigns, prepare content for every channel, approve it, publish it through each platform's official API (or hand it over as a "share bundle" for channels with no API), and later run ads within a budget cap and see results.

Michael has no platform accounts or keys yet, so every connector is built against the official API and stays off until credentials exist.

## What exists (PR 1: foundation, no screens yet)

- Data model, API, channel registry, post status machine, tracking, encrypted token storage, audit log.
- No concrete connectors yet (`connector: false` for every channel in the registry). No AI drafting yet. No pages yet.

## Flags and safety switches

| Switch | Where | Default | Effect |
| --- | --- | --- | --- |
| `GRACE_MARKETING_HUB` | environment | on | `false` hides the hub and makes every `/api/marketing/**` route answer 404 (kill switch). |
| `GRACE_MARKETING_LIVE` | environment | absent (off) | Must be exactly `true` for anything to leave the system. Absent on UAT. |
| `liveEnabled` | `MarketingSettings` | false | Owner switch inside the app. |
| `monthlySpendCapCents` | `MarketingSettings` | 0 | Ads can never push the month's committed spend above this. 0 means no spend possible. |
| `MARKETING_TOKEN_KEY` | environment | falls back to `JWT_SECRET` | Key material for encrypting channel tokens. |

### The one go-live gate

`assertCanGoLive({ settings, channel, post })` in `src/lib/marketing/flags.ts` is the only place that decides whether something may go out. ALL must hold:

1. `GRACE_MARKETING_LIVE === 'true'`
2. `settings.liveEnabled === true`
3. the channel is `CONNECTED` and has saved credentials
4. the post carries `approvedBy` and `approvedAt` (set only by an OWNER approving)

It throws a 409 with a plain reason when any one fails. Today it is called by `transitionPost` for `publish`, `retry` and `start`; every connector call added later must call it first.

### Other safety rules

- Ads (later PR) are always created paused on the platform and activated by a separate approved action, within the spend cap.
- The AI never invents prices, sizes or stock; those come from the Product row and are inserted by code.
- Tokens are AES-256-GCM encrypted (`v1:<iv>:<tag>:<ciphertext>`), never logged, never returned by any API. The UI shows only "connected, ends ...1234" (`tokenHint`).
- Every change to a post, campaign, content, channel or setting writes a `MarketingAuditLog` row.
- Every page and API is OWNER only.
- Migrations are additive (new tables only).

## Data model

Tables (all with `shopKey` default `vyra` for future multi-store): `MarketingSettings` (singleton id 1), `MarketingChannel`, `MarketingCampaign`, `MarketingCampaignProduct`, `MarketingContent`, `MarketingPost`, `MarketingAuditLog`. Channel kinds and statuses are strings validated in TypeScript (`src/lib/marketing/channels.ts`, `state.ts`), so a new channel needs no migration.

A content idea ("Pink party dress, new in") has one post per channel. Each post has its own `trackingTag` (`mk` + 12 hex) and `link` = product page + `?src=<tag>`. The existing analytics already records `?src=` as the campaign, so results per post are the rows where `campaign = trackingTag`.

## Post status machine (`src/lib/marketing/state.ts`)

```
DRAFT -> PENDING_APPROVAL (submit) | CANCELLED
PENDING_APPROVAL -> APPROVED (approve, owner) | REJECTED (reject, owner) | DRAFT (edit)
APPROVED -> SCHEDULED (api channel that can schedule, future time) | PUBLISHING (publish, api channel)
          | SHARED (manual channel, owner) | CANCELLED
SCHEDULED -> PUBLISHING (runner, when due) | CANCELLED | APPROVED (unschedule)
PUBLISHING -> PUBLISHED | FAILED
FAILED -> PUBLISHING (retry, at most 3 attempts) | CANCELLED
REJECTED -> DRAFT (edit)
```

Editing the words, photos or format of an approved or scheduled post sends it back to DRAFT and clears the approval: approval is for the exact words. Manual channels never go to SCHEDULED or PUBLISHING; they show as share bundles. Illegal moves answer 409 with a plain message. Writes use a compare-and-set on the old status, so two simultaneous clicks cannot both win.

## API (all OWNER only, 404 when the hub is off)

- `GET/PUT /api/marketing/settings`
- `GET /api/marketing/channels` (registry merged with saved rows; no credentials)
- `GET/POST /api/marketing/campaigns`, `GET/PATCH/DELETE /api/marketing/campaigns/[id]`
- `GET/POST /api/marketing/content` (POST may include `channels: [...]` to create one draft post per channel), `GET/PATCH/DELETE /api/marketing/content/[id]`
- `GET /api/marketing/posts?status=&channel=&from=&to=` (from/to match the scheduled or published time), `GET/PATCH /api/marketing/posts/[id]`
- `POST /api/marketing/posts/[id]/transition` with `{ action, scheduledFor? }`; actions: submit, cancel, approve, reject, schedule, unschedule, publish, retry, share
- `GET /api/marketing/audit?limit=&entity=`
- `POST /api/marketing/content/[id]/draft` with optional `{ channels }`: AI writes the DRAFT/REJECTED posts (see AI below)
- `GET /api/marketing/suggestions?limit=`: products worth promoting this week
- `POST /api/marketing/plan` with `{ start }`: proposed times for the approved posts (saves nothing)
- `POST /api/marketing/plan/apply` with `{ items: [{ postId, scheduledFor }] }`

## AI (`src/lib/marketing/ai/`)

Three helpers. Only the first calls a model.

- **Writer (`writer.ts`, `draft.ts`)**: for each channel of a content idea it writes the words for that channel's rules (length limit, hashtags for Instagram/TikTok/Threads, very short for WhatsApp Status, headline + primary text + description for ads, subject + body for email, 160 characters for SMS). British spelling, the warm VYRA boutique voice, plus the owner's voice notes (`brandVoice`) and the campaign goal. Claude is used when `ANTHROPIC_API_KEY` is set (model `ANTHROPIC_MARKETING_MODEL`, else `ANTHROPIC_LISTING_MODEL`, else the listing default); OpenAI (`OPENAI_LISTING_MODEL` constant) is the fallback when there is no Claude key or the Claude call fails. The result is saved on the draft post with `aiGenerated = true` and the cost added to `aiCostCents`. A rejected post goes back to DRAFT; anything past DRAFT/REJECTED answers 409; with no AI key the API answers 503 in plain words. AI text is never approved by itself: it still goes through submit and owner approval.
- **Suggestions (`suggest.ts`)**: ranks published products from data already in the database: newly published, in stock (or a pre-order shipping soon), popular (`ProductPopularity`), loved, and lower when already used in marketing content in the last 14 days. Each suggestion has a plain reason. No model call, no cost.
- **Week planner (`plan.ts`)**: spreads the approved, unscheduled posts across the week using `weeklyPostTarget` and the busiest visit hours of the last 8 weeks (`AnalyticsDailyHour`, Harare time; 12:00 and 19:00 when there is no data). The same channel never gets two posts within 3 hours. It only proposes. Applying schedules API channels through the normal `schedule` action; manual channels (WhatsApp Status and so on) only get a suggested day, nothing is stored.

### The placeholder rule

The model never writes a price, size or stock level. It writes `{price}`, `{sizes}` and `{link}`, and code fills them:

- `{price}` is the product's selling price only when the storefront would show it (`SHOW_PRICE` and a price above 0, via `publicPriceUsd`). Otherwise the sentence holding `{price}` is removed. A model that writes its own amount (`$39`, `USD`) or an unknown placeholder has that channel rejected.
- `{sizes}` is the product's `sizes` text; with none on file the sentence is removed.
- The post's own tracking link (`?src=<tag>`) is added by code at the end, once.
- Text over the channel limit is trimmed at a word boundary (the words, never the link or hashtags); if it still cannot fit, that channel fails and the owner is told, rather than posting something cut off.

### Cost

A draft costs about 1 to 3 cents for a few channels (Claude at about $4 / $20 per million input / output tokens; OpenAI fallback about $8 / $40). The estimate is stored per post in `aiCostCents`. Suggestions and the planner are free.

## Switching a channel on (later)

Each registry entry has plain-English `setupSteps` and `apiNotes` (what the official API cannot do). Channels with `mode: 'manual'` (Facebook Groups and Marketplace, WhatsApp Status, Channels and broadcast lists, influencers, resellers, classifieds, print/QR) need no keys: the hub prepares the content and the owner posts it and presses "Mark as shared".

## Coming in later PRs

Concrete connectors (Meta Graph API, Google, TikTok drafts, Pinterest, X, Telegram, YouTube, email, SMS, WhatsApp Cloud), screens, the scheduler/runner, ads with budget caps, audiences, contacts with opt-in, partners, daily results and recommendations.
