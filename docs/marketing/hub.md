# VYRA Marketing hub

An owner-only section of the VYRA admin to plan campaigns, prepare content for every channel, approve it, publish it through each platform's official API (or hand it over as a "share bundle" for channels with no API), and later run ads within a budget cap and see results.

Michael has no platform accounts or keys yet, so every connector is built against the official API and stays off until credentials exist.

## What exists (PR 1: foundation, no screens yet)

- Data model, API, channel registry, post status machine, tracking, encrypted token storage, audit log.
- Connectors: Facebook Page and Instagram (see below), plus Threads, Google Business Profile and Google Merchant Center (later section). Every other channel still has `connector: false`. No AI drafting yet. No pages yet.

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
- `POST /api/marketing/channels/connect` with `{ kind, ...fields }`: the fields per kind are `connectFields` in `channels.ts` (Facebook/Instagram `pageId` + `accessToken`; META_ADS; THREADS `accessToken`; GOOGLE_BUSINESS `accountId`, `locationId`, `clientId`, `clientSecret`, `refreshToken`; GOOGLE_MERCHANT `merchantId` + the three Google values). `POST /api/marketing/channels/[id]/disconnect`. `POST /api/marketing/channels/[id]/sync-products` with `{ mode?: 'products' | 'register-feed' }` (Google Merchant only; see below)
- `GET /api/marketing/audit?limit=&entity=`
- `POST /api/marketing/content/[id]/draft` with optional `{ channels }`: AI writes the DRAFT/REJECTED posts (see AI below)
- `GET /api/marketing/suggestions?limit=`: products worth promoting this week
- `POST /api/marketing/plan` with `{ start }`: proposed times for the approved posts (saves nothing)
- `POST /api/marketing/plan/apply` with `{ items: [{ postId, scheduledFor }] }`
- `GET /api/marketing/status`: whether the hub is on and why live posting is off (the nav uses it)
- `GET /api/marketing/products?q=&ids=`: published products with their photos, for the pickers
- `POST /api/marketing/content/[id]/posts` with `{ channels }`: add draft posts for more channels

## Screens (`/marketing`, owner only)

Overview (live status, counts, this week, share bundles ready), Campaigns, Content (pick a product and photos, tick channels, edit each channel's words with a live character count, act on each post), Approvals (the queue), Channels (what each channel can and can't do, and how to switch it on), Settings (live switch, spend cap, weekly target, brand voice), Activity (the audit log). Manual channels show a share bundle: photos through the phone's share sheet as JPEG, the caption with its tracking link, Copy caption, and Mark as shared.

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

## Ads (Meta: Facebook and Instagram), Pixel and product feed

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

**API (OWNER only):** `GET/POST /api/marketing/audiences`, `GET/PATCH/DELETE /audiences/[id]`; `GET/POST /api/marketing/ads`, `GET/PATCH/DELETE /ads/[id]`; `POST /ads/[id]/transition` `{ action: submit | approve | reject | create_on_platform | start | pause | cancel }`; `POST /ads/[id]/sync` (pulls insights into `MarketingMetric`, adds visits and enquiries from the analytics rows whose campaign is the ad's tracking tag, refreshes `spendCents`); `POST /ads/[id]/draft` (AI copy); `GET /api/marketing/budget` (cap, committed, remaining and recorded spend this month). Each ad has its own tracking tag and `?src=` link.

**AI ad copy** (`ai/ad-copy.ts`): headline, text and description for a DRAFT ad, from the product name, description, category and the brand voice only. The model never sees price, sizes or stock, and copy that contains a digit, `$` or `%` is refused. It never approves anything. It is a small standalone writer; point it at the shared channel writer when that lands.

### Meta Pixel (Conversions API)

`connectors/meta-pixel.ts`: `sendEvent` posts `PageView`, `ViewContent` or `Contact` (the WhatsApp enquiry) to `POST /{pixel_id}/events` with `action_source: website`, the page URL, optional product ids and `user_data` (IP and user agent as sent, email and phone SHA-256 hashed). It runs only when the live env is on, the live setting is on, a Pixel ID is saved in the settings and a META_ADS channel is connected; otherwise it throws 409 and sends nothing. `pixel.ts` exports `pixelConfigForStorefront()` (returns `null` unless all those gates pass). **The storefront is NOT wired up yet:** loading the browser Pixel and the visitor privacy notice wording are a later step, and must be done together.

### Product feed

`GET /api/public/marketing/feed.csv` and `feed.xml` (RSS 2.0 with the `g:` namespace) list published products only: id (item number), title, description, availability (in stock / out of stock / preorder), condition new, price like `12.00 USD` only when the storefront shows a price, link (`?src=feed`), image link (public JPEG rendition, 1200 px), brand VYRA, Google category when it can be worked out from the category name, `identifier_exists=no`. They answer 404 unless `productFeedEnabled` is on in the settings and the hub is not killed. No sign-in (public product data), cached for 5 minutes. Pieces with a hidden price are listed without one, and Meta and Google will flag them as missing a price.

## Pinterest, Telegram, X, YouTube and TikTok

Code: `src/lib/marketing/connectors/{pinterest,telegram,x,youtube,tiktok}.ts` (shared helpers in `common.ts`, credential names in `connect-fields.ts`). All five are registered, switched off until credentials exist, and every publish re-checks the go-live gate before any request. Official docs and the date checked (26 Nov 2026) are in a comment at the top of each file. Tests: `tests/marketing-social-connectors.test.ts` (fake fetch, no network).

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
- **Set up:** sign up at developer.x.com, create a project and app with "Read and write", turn on OAuth 2.0, add credit. Generate an OAuth 2.0 user token with scopes tweet.read, tweet.write, users.read, media.write, offline.access and paste it in the Connect box.
- **Can't do:** 280 characters (a link counts 23); the hub refuses longer text before calling X. User tokens expire after 2 hours unless refreshed, so a stored token will need re-entering until automatic refresh is added.

### YouTube
- **What it does:** uploads a video with `videos.insert` (resumable upload). Title is the first line of the post, description the rest plus the tracked link. Visibility is `unlisted` unless the channel config sets `privacy` to `private` or `public`.
- **A video is needed:** put a video link in the channel/post config as `videoUrl`, or attach a video file to the post. Without one the post fails with "YouTube needs a video file".
- **Set up:** create a YouTube channel for VYRA. In Google Cloud console create a project, enable "YouTube Data API v3", configure the consent screen, and create an OAuth client (Web). Use the OAuth Playground (or your own consent step) with scopes youtube.upload and youtube.readonly to get a refresh token. Paste the client ID, client secret and refresh token.
- **Can't do:** default quota is 100 uploads a day per project. Google can keep uploads from unaudited projects private: check the first upload in YouTube Studio. Videos are not made public by the hub unless you set `privacy: public`.

### TikTok (drafts only)
- **What it does:** "upload to inbox" only. Videos use `/v2/post/publish/inbox/video/init/` (TikTok pulls the file from a verified address, or the hub uploads the bytes when config `uploadMode` is `file`); photos use `/v2/post/publish/content/init/` with `post_mode: MEDIA_UPLOAD`. The result says "Sent to your TikTok inbox: open TikTok to post it": open the TikTok app, tap the inbox notification, add the caption and press Post.
- **Set up:** register at developers.tiktok.com, create an app with the Content Posting API and the scopes video.upload and user.info.basic, log in as the VYRA TikTok account to get an access token, and verify the VYRA website domain under URL properties. Paste the token in the Connect box.
- **Can't do:** the hub never posts directly (TikTok keeps posts from unaudited apps private). Video drafts carry no caption: type it in the app. At most 5 waiting drafts per 24 hours; 6 requests a minute. Photo drafts need TikTok app 31.8 or later.

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

## Coming in later PRs

Google Ads, email, SMS and WhatsApp Cloud connectors, contacts with opt-in, partners, daily results and recommendations.
