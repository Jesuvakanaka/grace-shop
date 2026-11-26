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

## Switching a channel on (later)

Each registry entry has plain-English `setupSteps` and `apiNotes` (what the official API cannot do). Channels with `mode: 'manual'` (Facebook Groups and Marketplace, WhatsApp Status, Channels and broadcast lists, influencers, resellers, classifieds, print/QR) need no keys: the hub prepares the content and the owner posts it and presses "Mark as shared".

## Coming in later PRs

Concrete connectors (Meta Graph API, Google, TikTok drafts, Pinterest, X, Telegram, YouTube, email, SMS, WhatsApp Cloud), AI drafting, screens, the scheduler/runner, ads with budget caps, audiences, contacts with opt-in, partners, daily results and recommendations.
