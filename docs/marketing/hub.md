# VYRA Marketing hub

An owner-only section of the VYRA admin to plan campaigns, prepare content for every channel, approve it, publish it through each platform's official API (or hand it over as a "share bundle" for channels with no API), run ads within a budget cap, message customers who opted in, and see results.

Michael has no platform accounts or keys yet, so every connector is built against the official API and stays off until credentials exist.

## What exists

The whole hub is built. Everything is owner-only, additive, and off until the owner switches it on.

- **Foundation:** data model, API, channel registry, post status machine, tracking links, AES-256-GCM token storage, audit log, the one go-live gate and the kill switch.
- **Screens** (`/marketing`): Overview, Campaigns, Content, Approvals, Channels, Ads, Audiences, Results, Contacts, Messages, Partners, Settings, Activity (see Screens below).
- **AI** that drafts words per channel, ad copy, product suggestions, a week plan and weekly advice (never prices, sizes or stock: code inserts those).
- **Connectors** (all built against the official APIs, none run against a real account yet): Facebook Page, Instagram, Threads, Pinterest, Telegram, X (with automatic token refresh), YouTube, TikTok (drafts to the inbox), Google Business Profile, Google Merchant Center (catalogue), Meta ads, Google Ads, WhatsApp Cloud API, Twilio SMS and Brevo email. Manual channels (Facebook Groups and Marketplace, WhatsApp Status, Channels and broadcast lists, influencers, resellers, classifieds, print and QR) get a share bundle instead.
- **Ads** on Meta and on Google Search, with a monthly spend cap, created paused and started by a separate approved action. Audiences, results sync and a product feed (Meta and Google Merchant).
- **Meta Pixel**: server-side events and the browser Pixel on the storefront, both behind the pixel gate (off by default).
- **Customer messages**: contacts with recorded consent, broadcasts, unsubscribe, partners with codes.
- **Background jobs**: `npm run marketing:run` and `npm run marketing:results` (see Running the background jobs). Nothing schedules them yet.

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
- `POST /api/marketing/posts/[id]/transition` with `{ action, scheduledFor? }`; actions: submit, cancel, approve, reject, schedule, unschedule, publish, retry, share. `publish` and `retry` really send the post through its connector (`publishPost`) and answer with the post as PUBLISHED or FAILED.
- `POST /api/marketing/channels/connect` with `{ kind, ...fields }`: the fields per kind are `connectFields` in `channels.ts` (Facebook/Instagram `pageId` + `accessToken`; META_ADS; THREADS `accessToken`; GOOGLE_BUSINESS `accountId`, `locationId`, `clientId`, `clientSecret`, `refreshToken`; GOOGLE_MERCHANT `merchantId` + the three Google values; GOOGLE_ADS `customerId`, optional `loginCustomerId`, `developerToken` + the three Google values; X `clientId`, optional `clientSecret`, `refreshToken`, `accessToken`). `POST /api/marketing/channels/[id]/disconnect`. `POST /api/marketing/channels/[id]/sync-products` with `{ mode?: 'products' | 'register-feed' }` (Google Merchant only; see below)
- `GET /api/marketing/audit?limit=&entity=`
- `POST /api/marketing/content/[id]/draft` with optional `{ channels }`: AI writes the DRAFT/REJECTED posts (see AI below)
- `GET /api/marketing/suggestions?limit=`: products worth promoting this week
- `POST /api/marketing/plan` with `{ start }`: proposed times for the approved posts (saves nothing)
- `POST /api/marketing/plan/apply` with `{ items: [{ postId, scheduledFor }] }`
- `GET /api/marketing/status`: whether the hub is on and why live posting is off (the nav uses it)
- `GET /api/marketing/products?q=&ids=`: published products with their photos, for the pickers
- `POST /api/marketing/content/[id]/posts` with `{ channels }`: add draft posts for more channels

## Screens (`/marketing`, owner only)

Overview (live status, counts, this week, share bundles ready), Campaigns, Content (pick a product and photos, tick channels, edit each channel's words with a live character count, act on each post), Approvals (the queue), Channels (what each channel can and can't do, and how to switch it on), Ads (Meta or Google, the monthly budget, one card per ad), Audiences (who sees an ad), Results (visits, enquiries, spend per channel, post, product, campaign and ad, plus weekly advice), Contacts (people and their consent), Messages (customer broadcasts), Partners (influencers and resellers with codes), Settings (live switch, spend cap, weekly target, brand voice, Pixel ID), Activity (the audit log). Manual channels show a share bundle: photos through the phone's share sheet as JPEG, the caption with its tracking link, Copy caption, and Mark as shared.

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

## Facebook Page and Instagram (Meta Graph API)

Code: `src/lib/marketing/connectors/` (`meta-graph.ts` client, `facebook-page.ts`, `instagram.ts`, `index.ts` registry), `connect.ts`, `publish.ts`, `scripts/marketing-run.ts`.

### What works

- **Facebook Page:** a text post, a link post, a one-photo post, or a several-photo post (photos are uploaded unpublished, then attached to one feed post). The tracked link (`?src=<tag>`) is added to the words when it is not already there. Stories and videos are not published automatically yet.
- **Instagram:** a one-photo post, a carousel (2 to 10 photos) or a story (first photo only, Instagram shows no caption on stories). The hub checks the 24-hour quota first, creates the container, waits for Instagram to finish processing it (a few checks a few seconds apart, never more than 5 minutes) and then publishes. Reels are not published automatically yet.
- **Photos:** platforms download photos from a public link, so the post's photos must belong to a published product and `GRACE_STOREFRONT_HOSTS` must be set (the first host is used). Instagram only accepts JPEG, so the hub asks for `/api/images/public/<key>.webp?format=jpeg`, a JPEG rendition added to the public image route (same visibility rule: only pictures that are already public; `w` still works with it).
- **Insights:** `fetchInsights` reads reach and clicks for Page posts and reach, likes, comments, shares for Instagram, and tolerates metrics Meta no longer returns.
- **Scheduling** is done by the hub, not by Meta: `npm run marketing:run` (optionally `-- --max 5`) publishes SCHEDULED posts that are due, but only when every go-live condition holds. Otherwise they stay SCHEDULED and the run prints the reason. At most 10 posts per run by default. Nothing runs it automatically yet: set up a scheduler (Cloud Run job, every 5 minutes) when you go live; no workflow or deploy file was changed.
- The Graph API version is one constant, `META_GRAPH_VERSION` (`v25.0`) in `meta-graph.ts`; override it with env `META_GRAPH_VERSION`.

### How to connect (the owner)

1. In Meta Business settings, add the VYRA Page and the Instagram account (a Business or Creator account linked to the Page) to your business.
2. Users, System users: add a system user and assign it the Page.
3. Generate a token for it with expiry "Never" and the permissions `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`.
4. In the hub, Connect Facebook Page (or Instagram) with the Page ID and the token. The hub checks the token with Meta (`GET /me`, then `GET /{page-id}?fields=id,name,instagram_business_account`), saves the Page and, when one is linked, the Instagram account, both as CONNECTED with the token encrypted. Only "ends ...1234" is ever shown.
5. Disconnect wipes the saved token and marks the channel NOT_CONNECTED.
6. Posting still needs `GRACE_MARKETING_LIVE=true` on the server, the live switch on in the settings, and an owner approval on each post.

If Meta rejects a saved token while publishing (error 190), the post is marked FAILED with a plain message and the channel moves to ERROR until you connect it again.

### Limits

- Posting needs Meta app review for `pages_manage_posts` and `instagram_content_publish` before it works for the public; while the app is in development mode only roles on the app can post.
- Instagram: JPEG only, 50 posts per 24 hours through the API, no shopping tags, no filters, no music, links in captions are not clickable.
- A failed post can be retried up to 3 attempts in all.
- Ads, the Pixel and the product feed are in the sections below.

## Ads (Meta and Google), Pixel and product feed

Code: `ads.ts`, `ad-state.ts`, `budget.ts`, `audiences.ts`, `connectors/meta-ads.ts`, `connectors/meta-pixel.ts`, `pixel.ts`, `feed.ts`, `feed-route.ts`, `ai/ad-copy.ts` in `src/lib/marketing/`.

### Ads

**Tables:** `MarketingAudience` (ad targeting: Harare 25 km by default, ages 18 to 65, optional gender and interests), `MarketingAd`, `MarketingMetric` (daily impressions, reach, clicks, spend, visits and enquiries per ad or post).

**Status machine** (`ad-state.ts`):

```
DRAFT -> PENDING_APPROVAL (submit) | CANCELLED
PENDING_APPROVAL -> APPROVED (approve, owner; also checks the cap) | REJECTED | DRAFT (edit)
APPROVED -> CREATING (create_on_platform, owner) -> PAUSED_ON_PLATFORM (made on Meta, PAUSED) | FAILED
PAUSED_ON_PLATFORM -> ACTIVE (start, owner: a separate action) | COMPLETED | CANCELLED
ACTIVE -> PAUSED_ON_PLATFORM (pause) | COMPLETED (end date passed, noticed on sync)
FAILED -> CREATING (retry, ids already made on Meta are reused) | DRAFT (edit)
```

Editing before the ad is on Meta sends it back to DRAFT and clears the approval. Once it is on Meta only the daily budget and end date can change, only while paused, the cap is re-checked, the approval is cleared and the owner approves again; `start` then pushes the approved budget and end date to Meta before switching on.

**Spend cap (hard rule 2)** (`budget.ts`): committed spend of a Harare month = for each ad that is ACTIVE, PAUSED_ON_PLATFORM, APPROVED or CREATING, its daily budget x the days of that month still to come between start and end (today counts), plus the spend already recorded that month. An ad is refused (409, plain message) at approval, at creation on Meta, at a budget change and at start when that would pass `monthlySpendCapCents`. Cap 0 means no spend is possible for any month. Ads that start next month are checked against next month. A Postgres advisory lock makes these decisions one at a time. Syncing an ACTIVE ad pauses it once the month's recorded spend has reached the cap. Only USD ad accounts are accepted because the cap is in US dollars. The minimum daily budget is $1.00.

**Gate (hard rule 1):** every call that creates, changes or starts an ad runs `assertCanGoLive` (live env, live setting, connected META_ADS channel with credentials, owner approval) and the cap check BEFORE any request; a connector call without them fails closed. Everything is created PAUSED. Two calls deliberately skip the live gate: pausing (stopping spend must work even when switches are off; it needs only saved credentials) and reading insights (read only).

**Meta calls** (`connectors/meta-ads.ts`, version from `META_GRAPH_VERSION`): campaign, ad set, creative (`object_story_spec`, `link_data`), ad, all `status=PAUSED`; activate = `status=ACTIVE` on campaign, ad set, then ad; insights = `GET /{ad_id}/insights?fields=impressions,reach,clicks,spend&time_increment=1&date_preset=last_7d`. **The field mapping was written from Meta's documented fields and has not been run against a real ad account (the owner has none yet). It lives in the `build*` functions of one file, must be verified with a real account, and Meta's required fields change between versions.** Objectives: TRAFFIC (OUTCOME_TRAFFIC, LINK_CLICKS, Shop now), ENGAGEMENT (OUTCOME_ENGAGEMENT, POST_ENGAGEMENT, Learn more), CLICK_TO_WHATSAPP (OUTCOME_ENGAGEMENT, CONVERSATIONS, destination WHATSAPP, WhatsApp message button). The ad uses its first photo (as a public JPEG link). Meta errors are shown in Meta's own words.

**Connect the ad account:** `POST /api/marketing/channels/connect` with `{ kind: 'META_ADS', adAccountId, pageId, accessToken }`. The hub checks `GET /act_{id}?fields=id,name,currency,account_status` (must be active), stores the channel CONNECTED with the three values encrypted. How: in Business Settings add the ad account, add a payment method that works from Zimbabwe, test with a $1 a day ad first, create a system user with `ads_management` and `ads_read` (expiry Never; standard access is enough for your own ad account).

**API (OWNER only):** `GET/POST /api/marketing/audiences`, `GET/PATCH/DELETE /audiences/[id]`; `GET/POST /api/marketing/ads`, `GET/PATCH/DELETE /ads/[id]`; `POST /ads/[id]/transition` `{ action: submit | approve | reject | create_on_platform | start | pause | cancel }`; `POST /ads/[id]/sync` (pulls insights into `MarketingMetric`, adds visits and enquiries from the analytics rows whose campaign is the ad's tracking tag, refreshes `spendCents`); `POST /ads/[id]/draft` (AI copy; the Ads screen's "Write with AI" button saves a draft from the chosen content idea and then calls it); `GET /api/marketing/budget` (cap, committed, remaining and recorded spend this month). Each ad has its own tracking tag and `?src=` link.

**AI ad copy** (`ai/ad-copy.ts`): headline, text and description for a DRAFT ad, from the product name, description, category and the brand voice only. The model never sees price, sizes or stock, and copy that contains a digit, `$` or `%` is refused. It never approves anything. It is a small standalone writer; point it at the shared channel writer when that lands.

### Meta Pixel (browser and Conversions API)

**Server side** (`connectors/meta-pixel.ts`): `sendEvent` posts `PageView`, `ViewContent` or `Contact` (the WhatsApp enquiry) to `POST /{pixel_id}/events` with `action_source: website`, the page URL, optional product ids and `user_data` (IP and user agent as sent, email and phone SHA-256 hashed). It runs only when the live env is on, the live setting is on, a Pixel ID is saved in the settings and a META_ADS channel is connected; otherwise it throws 409 and sends nothing.

**Browser** (`pixel.ts`, `components/storefront/MetaPixel.tsx`, `PixelViewContent.tsx`): the public storefront layout (`src/app/site/layout.tsx`) loads Meta's base code with `next/script` (`afterInteractive`, one inline script with the Pixel ID, which sends `PageView`), and the product page (`/p/<slug>`) adds a `ViewContent` event with the piece's item number (the same id the product feed uses). **Both appear only when the pixel gate passes**: `GRACE_MARKETING_LIVE=true`, the live setting on, a Pixel ID (digits only) saved in Settings, and a connected Meta ad account. When the gate does not pass (the default) the layout and the product page return exactly their old trees: no script, no extra markup, and with the live env off not even a database read (`tests/marketing-pixel-storefront.test.ts`). An owner preview never sends `ViewContent`.

Before you turn it on:
- **Update the privacy page** (`/privacy`) to say visitors' visits are shared with Meta for ads. The Pixel sets Meta cookies and sends page visits to Meta; check whether the law where your visitors live asks for consent first. The hub does not show a consent banner.
- Only first page loads send `PageView`; moving between pages inside the app without a reload does not send another. That is a known limit.
- Check Events Manager, Test events, with a real Pixel: it has never been run against one.

### Product feed

`GET /api/public/marketing/feed.csv` and `feed.xml` (RSS 2.0 with the `g:` namespace) list published products only: id (item number), title, description, availability (in stock / out of stock / preorder), condition new, price like `12.00 USD` only when the storefront shows a price, link (`?src=feed`), image link (public JPEG rendition, 1200 px), brand VYRA, Google category when it can be worked out from the category name, `identifier_exists=no`. They answer 404 unless `productFeedEnabled` is on in the settings and the hub is not killed. No sign-in (public product data), cached for 5 minutes. Pieces with a hidden price are listed without one, and Meta and Google will flag them as missing a price.

## Pinterest, Telegram, X, YouTube and TikTok

Code: `src/lib/marketing/connectors/{pinterest,telegram,x,youtube,tiktok}.ts` (shared helpers in `common.ts`; the Connect form fields are in `channels.ts` `CONNECT_FIELDS`). All five are registered, switched off until credentials exist, and every publish re-checks the go-live gate before any request. Official docs and the date checked (26 Nov 2026) are in a comment at the top of each file. Tests: `tests/marketing-social-connectors.test.ts` (fake fetch, no network).

Errors: a rejected or expired token gives code 401 and is not retried (reconnect the channel); rate limits (429) and server errors (5xx) are retryable. A publish result may carry a `message` for the owner (cost, "open the app").

### Pinterest
- **What it does:** creates a Pin with `POST /v5/pins`: board, title (first line, max 100), description (rest, max 800), the tracked link and the first photo. Needs a photo.
- **Set up:** make a free Pinterest Business account and claim the VYRA website; at developers.pinterest.com create an app, then generate an access token with the scopes boards:read, pins:read, pins:write and user_accounts:read. In the Connect box paste the token and the board ID (the number in the board's address, or from the API's boards list).
- **Can't do:** new apps have "trial" access: pins are visible only to you until Pinterest upgrades the app to Standard. One board per pin. No video pins yet.

### Telegram
- **What it does:** posts to a channel: text (`sendMessage`), one photo with a caption (`sendPhoto`) or 2 to 10 photos (`sendMediaGroup`, caption on the first). A caption over 1024 characters goes as a message right after the photos.
- **Set up:** create a channel in Telegram; message @BotFather, send `/newbot`, copy the token; open the channel, Administrators, add the bot and let it post messages. In the Connect box paste the token and the channel (`@vyrashop` or the numeric chat ID). Connecting checks the token (`getMe`) and the channel (`getChat`).
- **Can't do:** the bot API cannot read channel views; no polls or videos yet.

### X
- **What it does:** creates a post with `POST /2/tweets`, with up to 4 photos uploaded first through the v2 media upload (`/2/media/upload/initialize`, `append`, `finalize`).
- **Cost (pay per use):** $0.015 per post, $0.20 for a post with a link. Every tracked post has a link, so expect $0.20 each. The result and the server log show the expected cost.
- **Set up:** sign up at developer.x.com, create a project and app with "Read and write", turn on OAuth 2.0, add credit. Sign in as the VYRA account once (authorization code with PKCE, scopes tweet.read, tweet.write, users.read, media.write and **offline.access**) to get an access token and a refresh token. Paste the client ID, the client secret (only if the app is a confidential one), the refresh token and the access token in the Connect box. All are saved encrypted; only the client ID (not secret) is kept in `config`.
- **Token refresh** (`refreshXCredentials` in `connectors/x.ts`, called by `publishPost` through the connector's `refreshCredentials`): after the go-live gate and before the post, `POST https://api.x.com/2/oauth2/token` with `grant_type=refresh_token` (form-encoded; a public app sends `client_id` in the body, a confidential app sends `Authorization: Basic` with client ID and secret). X answers with a new access token and a new refresh token (refresh tokens are single use), and both are saved straight away with `updateCredentials` in `connect.ts` (encrypted, one audit row `channel.credentials_refreshed`, no token in it). If X rejects the refresh token the post fails with "connect the channel again" and the channel moves to ERROR. Channels saved before this (access token only) still post until their token expires. Two posts published at the very same moment could both try to refresh; the second would fail and can be retried. Nothing logs a token. Verified against the docs only (https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token, checked 2026-11-26), never against the real service.
- **Can't do:** 280 characters (a link counts 23); the hub refuses longer text before calling X. User tokens last about 2 hours, so the hub renews them before every post (see Token refresh below).

### YouTube
- **What it does:** uploads a video with `videos.insert` (resumable upload). Title is the first line of the post, description the rest plus the tracked link. Visibility is `unlisted` unless the channel config sets `privacy` to `private` or `public`.
- **A video is needed:** put a video link in the channel/post config as `videoUrl`, or attach a video file to the post. Without one the post fails with "YouTube needs a video file".
- **Set up:** create a YouTube channel for VYRA. In Google Cloud console create a project, enable "YouTube Data API v3", configure the consent screen, and create an OAuth client (Web). Use the OAuth Playground (or your own consent step) with scopes youtube.upload and youtube.readonly to get a refresh token. Paste the client ID, client secret and refresh token.
- **Can't do:** default quota is 100 uploads a day per project. Google can keep uploads from unaudited projects private: check the first upload in YouTube Studio. Videos are not made public by the hub unless you set `privacy: public`.

### TikTok (drafts only)
- **What it does:** "upload to inbox" only. Videos use `/v2/post/publish/inbox/video/init/` (TikTok pulls the file from a verified address, or the hub uploads the bytes when config `uploadMode` is `file`); photos use `/v2/post/publish/content/init/` with `post_mode: MEDIA_UPLOAD`. The result says "Sent to your TikTok inbox: open TikTok to post it": open the TikTok app, tap the inbox notification, add the caption and press Post.
- **Set up:** register at developers.tiktok.com, create an app with the Content Posting API and the scopes video.upload and user.info.basic, log in as the VYRA TikTok account to get an access token, and verify the VYRA website domain under URL properties. Paste the token in the Connect box.
- **Can't do:** the hub never posts directly (TikTok keeps posts from unaudited apps private). Video drafts carry no caption: type it in the app. At most 5 waiting drafts per 24 hours; 6 requests a minute. Photo drafts need TikTok app 31.8 or later.

## Results and weekly advice

Code: `results.ts`, `ai/recommend.ts` in `src/lib/marketing/`; `scripts/marketing-results.ts`. Screens: Results, Ads, Audiences (tabs in `/marketing`).

### Results

- **Daily rows** go in `MarketingMetric` (entity `POST` for posts, `AD` for ads). Post visits and enquiries are the `AnalyticsDailySource` rows whose `campaign` is the post's tracking tag. Impressions, reach and clicks come from the connector's `fetchInsights` (Facebook Page: `post_impressions`, `post_impressions_unique`, `post_clicks`; Instagram: `views`, `reach`, likes, comments, shares, saved), only for PUBLISHED posts on a connected channel. This is read only, so it needs saved credentials but not the go-live switches.
- Platforms report lifetime totals, so each day stores only what is new since the earlier days (today's row = lifetime minus the sum before today). Running the sync twice in a day does not double count. A platform error leaves earlier numbers alone and the visits are still counted.
- **Ads** reuse the ad sync (`syncAd`): ACTIVE and paused-on-Meta ads are pulled in the same run.
- **Run it:** the Results page button "Update the numbers", `POST /api/marketing/results/sync`, or `npm run marketing:results` (daily is plenty; set up a scheduler when you go live, none is configured). Exits 1 only when an ad could not be synced.
- **Report:** `GET /api/marketing/results?from=YYYY-MM-DD&to=YYYY-MM-DD` (default the last 30 Harare days, at most a year). Returns totals, `perPost`, `perChannel`, `perCampaign`, `perProduct`, `perAd` and `spendCents` (ads). Ads count in the channel (META_ADS), campaign and product tables.

### Weekly advice

- `MarketingRecommendation` (week starting Monday Harare, kind, title, body, data, status NEW / DONE / DISMISSED, aiCostCents).
- **Code works out the facts** over the last 28 days: best channel, best product (by visits, enquiries break ties), best day and hour (Harare time, average visits per post, only with 3 or more posts), posts with no visits (older than 2 days), connected channels not used, and ad budget left. Each fact has a plain rule-based text.
- **The AI only rewords.** With a key (same Claude-then-OpenAI pattern as the writer, injectable client) it rewrites each text; any number that is not in the rule text makes that item keep the rule text. Without a key, or if the AI fails, the rule text is saved (and the failure is shown). Cost is stored in `aiCostCents` (about a cent).
- Generating again replaces the week's NEW items; DONE and DISMISSED ones stay and are not repeated.
- API (OWNER only): `GET /api/marketing/recommendations?status=&week=`, `POST .../generate`, `PATCH .../[id]` `{ status }`. Generating and every status change write an audit row.

### Screens

- **Results:** date range, totals, tables by channel, post, product, campaign and ad, "Update the numbers", and the advice with Done, Dismiss and "Get this week's advice".
- **Ads:** monthly limit, spent and free (from `/api/marketing/budget`), a form to make a draft from a content idea (audience, daily budget, dates), and a card per ad with the next step only (ask for approval, approve, create on Meta paused, start with a confirmation, pause). Refusals from the cap or the go-live gate show in the server's own plain words on the ad.
- **Audiences:** list and a simple form (distance from Harare, ages, who).

## Switching a channel on

Each registry entry has plain-English `setupSteps` and `apiNotes` (what the official API cannot do). Channels with `mode: 'manual'` (Facebook Groups and Marketplace, WhatsApp Status, Channels and broadcast lists, influencers, resellers, classifieds, print/QR) need no keys: the hub prepares the content and the owner posts it and presses "Mark as shared".

## Threads, Google Business Profile and Google Merchant Center

Code: `connectors/threads.ts`, `google-business.ts`, `google-merchant.ts`, `google-oauth.ts`, `merchant-sync.ts`, `connect.ts` (`connectWithFields`). Every connector file has the official doc URLs and the date they were checked (2026-11-26) at the top. None has been run against a real account: the owner has none yet.

**Connect form:** each registry entry has `connectFields` (name, label, kind `digits` | `text` | `secret`). The Channels page and the connect API both use that list, and `connectFieldsError` checks it (no blanks, no spaces, digits where a number is expected). The connector's own `verify()` makes a read-only call first; the values are then saved AES-256-GCM encrypted. Non-secret values (IDs, client ID) go into `config`; secrets (token, client secret, refresh token) only into `credentialsEnc`. Only "ends ...1234" (last 4 of the last secret field) is returned. Reconnecting keeps other saved `config` keys.

### Threads (`graph.threads.net/v1.0`)
Text or one-photo posts. Step 1 `POST /{user}/threads` (`media_type=TEXT` with `link_attachment`, or `IMAGE` with `image_url`, the tracked link goes in the words), poll `GET /{container}?fields=status,error_message` until FINISHED, step 2 `POST /{user}/threads_publish` with `creation_id`. 500 characters. The version is the constant `THREADS_API_VERSION` (`v1.0`, the one the docs show); override with env `THREADS_API_VERSION`. Same go-live checks as Facebook (`assertCanGoLive`, checked again inside the connector). Setup steps are in the registry (Threads tester role, `threads_basic` + `threads_content_publish`, long-lived token that lasts 60 days and must be renewed).

### Google Business Profile
"What's new" local post (`topicType STANDARD`, a photo, a Learn more button carrying the tracked link): `POST https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/localPosts` after exchanging the refresh token at `oauth2.googleapis.com/token`. `verify()` lists the account's locations (`mybusinessbusinessinformation.googleapis.com/v1`) and checks the saved one is there. **API access needs Google's approval of the Cloud project**; until then Google answers 403 and the hub says so. A Call button instead of Learn more can be set by hand in the channel's `config` (`{"callToAction":"CALL"}`); there is no screen for it yet. Credentials Google rejects (revoked refresh token) fail the post and move the channel to ERROR.

### Google Merchant Center (Merchant API, not the Content API that ended on 18 Aug 2026)
This channel carries the catalogue, not posts: `publish` always answers "carries your product catalogue, not posts" and sends nothing (its registry `publish` capability is off). Two owner actions, `POST /api/marketing/channels/[id]/sync-products`:
- `register-feed`: creates a scheduled file-fetch data source pointing at `https://<storefront host>/api/public/marketing/feed.xml`.
- `products` (default): builds the rows with `feed.ts` from the public product DTO (published products only), and inserts each one with `productInputs:insert` into an API data source (created once and saved in `config.apiDataSource`). Products with no price or photo are skipped (Google requires both). At most 500 per run; it stops after 3 refusals in a row or rejected credentials.

**The sync gate (`assertCanSync` in `flags.ts`):** there is no post to approve, so ALL of: `GRACE_MARKETING_LIVE === 'true'`, `settings.liveEnabled`, the channel CONNECTED with credentials, and the caller is an OWNER (STAFF, SYSTEM or no actor are blocked). The route also needs `productFeedEnabled` on. The gate runs in the service before anything is decrypted or loaded and again inside the connector before every request group. A failed sync writes `channel.sync_failed` to the audit log, a good one `channel.sync` with counts only.

### How to switch each one on (plain English)

**Threads**
1. Check the VYRA Instagram account has a Threads profile.
2. In Meta for Developers create an app and add the Threads API. Add the VYRA profile as a Threads tester and accept the invitation in the Threads app.
3. Generate a token with `threads_basic` and `threads_content_publish` and swap it for a long-lived one (60 days).
4. Channels, Threads, paste the token, Connect. Put a reminder in your diary to renew it before 60 days.

**Google Business Profile**
1. Claim and verify the VYRA listing on Google.
2. In Google Cloud make a project and fill in Google's "Business Profile API access" request. Wait for approval (days).
3. Enable the Business Profile APIs, create an OAuth client ID (Web application), and get a refresh token for the account that manages the listing (scope `business.manage`).
4. Note the account number and location number (accounts/123/locations/456).
5. Channels, Google Business Profile, fill in the five boxes, Connect.

**Google Merchant Center**
1. Create the Merchant Center account, verify and claim the website.
2. In Google Cloud enable the Merchant API, create an OAuth client ID (Web application), and get a refresh token for a Merchant Center admin (scope `content`). Register the project under Merchant Center, Settings, Developer registration.
3. Channels, Google Merchant Center, enter the Merchant ID and the three Google values, Connect.
4. In Settings turn on "Product feed" (and live posting when ready; the server also needs `GRACE_MARKETING_LIVE=true`).
5. Press "Register my product feed with Google" (Google then fetches the feed daily) or "Send products to Google" (sends them now).

**Not verified against the real services:** the exact `primaryProductDataSource` + `fetchSettings` body (taken from Google's Python sample, not a REST example), `productAttributes` field spellings that Google's insert examples do not show (`brand`, `identifierExists`, `productTypes`, `googleProductCategory`, `additionalImageLinks`), the Merchant `accounts/v1` verify call, the Business Profile `mediaFormat: PHOTO` field, and Threads' current API version.

## Google Ads (Search)

Code: `connectors/google-ads.ts`, wired into `ads.ts` next to Meta (the ad's `channelKind` is `META_ADS` or `GOOGLE_ADS`). API version `v26` (v26.2 released 11 Nov 2026; checked on developers.google.com/google-ads/api/docs/release-notes on 2026-11-26; each version is sunset about a year after release, so bump `GOOGLE_ADS_VERSION` in time). **Written from Google's documented REST shapes and never run against a real account.**

**Same steps as Meta:** submit, approve (cap check), create on Google (paused), start (a separate action), pause, sync. Every call that creates, changes or starts anything runs `assertCanGoLive` and the spend-cap check under the same budget lock before any request (the Google sign-in request counts as a request). Pausing and reading results need only saved credentials.

**What is made (all PAUSED):** a campaign budget (`amountMicros` = daily budget in cents x 10,000), a Search campaign (Google Search only: no search partners, no Display; "Maximize clicks" so no bid is invented; start and end date in Harare time; "people in the place" targeting), a radius around Harare (or the audience's place) **only when the ad has an audience**, one ad group, and one responsive search ad whose final URL is the tracked link. The headline, words and description are split into Google's limits (3 to 15 headlines of 30 characters, 2 to 4 descriptions of 90) from the ad's own words; only when there are too few pieces are short generic VYRA lines added; "!" is dropped from headlines. Ids are kept on the ad row: campaign id in `externalCampaignId`, ad group in `externalAdSetId`, campaign budget in `externalCreativeId`, ad in `externalAdId`. A failed create keeps the ids and a retry resumes.

**Results:** a GAQL search (`POST .../googleAds:search`) on `metrics.cost_micros`, `metrics.impressions` and `metrics.clicks` for the ad, last 7 days (cost micros / 10,000 = US cents). The monthly cap counts spend from both platforms.

**Connect:** customer ID (dashes fine), optional manager (login) customer ID, developer token, and the Google OAuth client ID, client secret and refresh token (scope `https://www.googleapis.com/auth/adwords`). The hub checks the customer with a read-only GAQL query (must be enabled; the currency is saved and only USD is accepted). Requests carry the `developer-token` header and `login-customer-id` when given.

**Things to know:**
- The developer token needs Google's approval ("Basic access", Google Ads, Tools, API Center) before it works on a real account. Until then Google refuses every call and the hub says so.
- Google Ads bills the card saved on the **Google Ads account**, not VYRA. The monthly cap here is VYRA's own guard on top.
- **Keywords are not added.** A Search ad group with no keywords does not show. Add keywords in Google Ads before you press Start.
- Only "visits to the shop" ads (objective TRAFFIC); no photo is used; age, gender and interests are not sent.
- The Google Ads account time zone is assumed to be Harare.

**Switching it on (plain English):** open a Google Ads account in US dollars with a card; ask for a developer token and wait for Basic access; create a Google Cloud OAuth client and get a refresh token for a user with access to the account; Channels, Google Ads, fill in the boxes, Connect; set the monthly cap in Settings; on the Ads screen choose "Google search" (it shows when Meta and Google are both connected; Meta is the default); make the ad, ask for approval, approve, create on Google, add keywords in Google Ads, press Start.

## Running the background jobs

Two scripts do the work that cannot happen inside a page request. Both need `DATABASE_URL`, print only counts and plain reasons (never tokens), and do nothing when the hub is off (`GRACE_MARKETING_HUB=false`).

| Script | How often | What it does |
| --- | --- | --- |
| `npm run marketing:run` | every 5 minutes | Publishes SCHEDULED posts that are due and sends approved customer broadcasts that are due (or carries on with ones being sent). Posts and messages go out only when the whole go-live gate passes; otherwise they stay as they are. `-- --max 5` limits the posts per run (default 10). Exits 1 if a post failed. |
| `npm run marketing:results` | once a day | Pulls the last days of results (post reach and clicks, ad spend and clicks from Meta and Google) into the results tables. Read only on the platforms, so it needs no go-live gate. Safe to run any time. It also pauses a running ad once the month's recorded spend has reached the cap. |

Run them by hand from the server or a developer machine at any time. **Nothing runs them automatically yet**, and no scheduler or workflow was created or changed (`.github/workflows` is untouched).

**Setting them up later on Cloud Run** (when the owner goes live; either way keep `GRACE_MARKETING_LIVE` and the database settings the same as the web service):
- **Cloud Run job + Cloud Scheduler (recommended):** make two Cloud Run jobs from the same container image as the web app, with the command `npm run marketing:run` and `npm run marketing:results`, and the same environment variables and Cloud SQL connection as the service. Then create two Cloud Scheduler jobs that run them: `*/5 * * * *` (time zone Africa/Harare) and `0 5 * * *`. The scheduler calls the Cloud Run Admin API `jobs.run` with a service account that has the "Cloud Run Invoker" role on those jobs.
- **Protected route instead:** add an owner-less route such as `POST /api/marketing/cron/run` that checks a long random secret in an `Authorization: Bearer` header (kept in Secret Manager, compared in constant time) and then calls the same functions the scripts call (`runDuePosts`, `runDueBroadcasts`, `syncAllResults`). Cloud Scheduler then calls it over HTTPS with that header every 5 minutes and daily. Do not expose it without the secret. This route does not exist yet.
- A run that overlaps the next one is fine for posts and messages (each is claimed before it is sent), but keep the schedule at 5 minutes or more.

## Contacts, messages and partners (ZP-1200)

### The rule that cannot be broken

A message (email, text or WhatsApp) goes to a person only when **all** of these hold:

1. That person has a recorded **opt-in for that exact channel** (WhatsApp consent does not allow SMS or email) and the **latest** consent row is not an opt-out.
2. `GRACE_MARKETING_LIVE=true` on the server, live sending switched on in Settings, the channel connected with saved credentials, and the **owner approved the exact words** (`assertCanGoLive`, with the broadcast as the item). Editing approved words sends it back to a draft.
3. The daily limit (Messages screen, default 100 a day, all channels together) is not used up.

The list of people is worked out again at the moment of sending, and each person's consent is checked again right before their message, so an opt-out during a send is honoured. Messages go out about one a second (`GRACE_MARKETING_SEND_PER_SECOND`, default 1, at most 10), at most 500 per run. Each person has one row per message (unique), claimed before the request, so nobody gets it twice. "Try again" only re-sends people it did not reach; a message whose outcome is unknown (a run that died mid-send) is **never** re-sent automatically.

### Contacts and consent

- Tables: `MarketingContact` (phone in E.164, unique per shop; email unique per shop), `MarketingConsent` (one row per change, newest wins, with how it was given and optional proof).
- Zimbabwe numbers: `077 123 4567`, `0771234567`, `263771234567`, `+263 77 123 4567` all become `+263771234567`. Other countries need `+`.
- A new contact has **no** consent. Opting in is always an explicit owner action (a "how did they say so" text is required), or a clear yes in an imported file that the owner confirms.
- **CSV import** (Contacts screen, `POST /api/marketing/contacts/import`): columns `name`, `phone`, `email`, `notes`, and optionally `whatsapp_consent`, `sms_consent`, `email_consent` (yes/no), `consent_method`, `consent_evidence`. The preview writes nothing. Without a consent column nobody is opted in. A yes never overrides an earlier opt-out. Opt-ins need the owner to tick "I confirm". The import is audited (file name and counts).
- **Add from enquiries: not built.** The website's enquiry (WhatsApp tap) data is anonymous (no phone numbers, see `AnalyticsEvent`), so there is nothing to suggest contacts from. Contacts are added by hand or by import.
- **Unsubscribe**: `GET/POST /api/public/marketing/unsubscribe?t=<token>` (public). The token is `contactId.CHANNEL.hmac` (HMAC-SHA256, key derived like `secrets.ts` with info `grace-marketing-unsubscribe-v1`); a changed token writes nothing. It only ever records an opt-out, never expires, and works even when `GRACE_MARKETING_HUB=false`. Every email carries the link in the footer and as `List-Unsubscribe` / `List-Unsubscribe-Post` headers; every text ends "Reply STOP to opt out."; if Twilio reports a STOP reply (error 21610) the hub records an opt-out. Replies to WhatsApp are not read: record a WhatsApp opt-out by hand on the contact.
- No delete for contacts on purpose: deleting would also erase the proof of an opt-out. Ask for a database change if someone must be erased.

### Messages (broadcasts)

`MarketingBroadcast` and `MarketingBroadcastRecipient`. Status machine in `broadcast-state.ts` (pure, tested): DRAFT, PENDING_APPROVAL, APPROVED, SENDING, SENT or FAILED, CANCELLED, REJECTED. Links to your own shop in the words get `?src=<tag>` so visits show up in Results. `{name}` becomes the first name (or "there"). The screen shows how many people would get it, why others are left out, and every reason a send is blocked. Sending runs a small batch per button press ("Send the next batch"); `npm run marketing:run` also starts approved messages whose scheduled time has come and carries on with ones being sent.

API (OWNER only): `/api/marketing/contacts`, `/contacts/[id]`, `/contacts/[id]/consent`, `/contacts/import`, `/broadcasts`, `/broadcasts/[id]` (audience count and blocked reasons), `/broadcasts/[id]/transition` (`submit, approve, reject, send, retry, continue, cancel`), `/broadcasts/[id]/recipients`, `/partners`, `/partners/[id]`, `/partners/[id]/kit`.

### Partners (influencers, resellers, ambassadors)

`MarketingPartner` has a short readable `code` (`[a-z0-9-]`, 3 to 32, checked to survive the analytics tag cleaning). It is the `?src=` tag on their links; **it cannot be changed** once made because links are already out. Results (visits and enquiring visits over the last 30 days) come from `AnalyticsDailySource` where `campaign = code`. The share kit is the tracked link to the shop or one product, fixed words (no prices: nothing is invented), and the product photos for the phone's share sheet. The hub **pays nothing**: commission is a reminder, not a payment.

### Setting each one up (plain English)

**WhatsApp Business Cloud API**

> Read this first. Moving your shop's WhatsApp number onto the Cloud API changes how the WhatsApp Business app works on that number. With Meta's "coexistence" option the app keeps working for normal chats, but **broadcast lists become read-only** in the app, and some features differ. A number that is not yet on WhatsApp is the safest choice. Check Meta's current rules before you move the number you use every day.

1. Create a Meta business (business.facebook.com) and, in Meta for Developers, an app with the WhatsApp product.
2. Add a phone number to the app and note the **phone number ID** (WhatsApp, API Setup).
3. In WhatsApp Manager write a **message template** (category Marketing) and wait for Meta to approve it. You will type its exact name and language in the hub.
4. Make a system user with `whatsapp_business_messaging` and `whatsapp_business_management` and generate a permanent token.
5. In Marketing, Channels, WhatsApp Business: paste the phone number ID and the token.
6. Record who agreed to WhatsApp messages (Contacts), write the message (Messages), approve it, then send.

Meta **charges per marketing template message** delivered, and may decline to deliver some marketing messages. Check Meta's price list for Zimbabwe numbers before a big send. Outside the 24-hour reply window only approved templates can be sent: the hub never sends free text. Endpoint used: `POST https://graph.facebook.com/<version>/<phone-number-id>/messages` (docs: developers.facebook.com/docs/whatsapp/cloud-api/reference/messages, checked 26 Nov 2026).

**Twilio (text messages)**

1. Create a Twilio account (twilio.com) and add a little credit.
2. Get a sender that can text Zimbabwe. **Zimbabwe sender IDs and pricing need checking with Twilio**: some countries need a registered sender name, and prices differ by network. Test with your own number first.
3. Copy the Account SID (starts `AC`) and the Auth Token from the Twilio console.
4. In Channels, Text messages: paste the account ID, the sender (a number like `+12025550123`, a sender name, or a Messaging Service ID starting `MG`) and the token.

Endpoint: `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`, form-encoded, basic auth (docs: twilio.com/docs/sms/api/message-resource, checked 26 Nov 2026). Texts over 160 characters cost several parts.

**Brevo (email)**

1. Create a free Brevo account (brevo.com). The free plan has a daily limit and Brevo branding; check the current limits.
2. Verify the address or domain you send from (Senders, Domains and dedicated IPs). Unverified senders are refused.
3. Create an API key (SMTP and API, API keys).
4. In Channels, Email newsletter: paste the sender address and the API key.
5. Put your shop address in the words of the email if the law asks for it.

Endpoint: `POST https://api.brevo.com/v3/smtp/email` with the `api-key` header (docs: developers.brevo.com/reference/send-transac-email, checked 26 Nov 2026).

**Not verified against the real services:** all three connectors are tested only with a fake fetch. In particular: that Brevo accepts the `List-Unsubscribe` and `List-Unsubscribe-Post` custom headers on a transactional send (its docs say "standard headers are not supported"), Twilio's error codes beyond 21610, 21211 and 20429, and Meta's error codes for template problems.
