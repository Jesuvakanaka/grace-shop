# AI Marketing Manager: clickable prototype

An isolated, clickable prototype of the owner experience for VYRA's AI Marketing Manager. It exists so the owner can use the intended product before any backend is built.

**Boundaries.** Fictional sample data only. No database changes, no migrations, no AI calls, no publishing, no customer messages, no ad spend, no real account connections. State lives in the visitor's browser (`localStorage` key `vyra-marketing-manager-prototype-v1`). A persistent bar on every screen says "Interactive prototype · Sample data · No real messages or spending." and carries **Reset demo**.

## Opening it

- Local: `npm install`, then `npm run dev`, then open <http://localhost:3000/prototype/marketing-manager>.
- On a deployed admin host (UAT) it would be at `/prototype/marketing-manager`. It is **not deployed**; deploying needs a separate instruction.
- No sign-in. The route sits in its own route group, `src/app/(prototype)/`, outside `(admin)`, because it reads no shop data. Pages carry `noindex`. On the storefront host the path is a 404 (host routing rewrites unknown paths to `/site/**`).

## Walkthrough of the main journey

1. **Understand my business.** First visit opens seven short questions with editable example answers: what you sell, who to reach, where you deliver, why choose you, policies, language and voice, budget. "Help me decide" offers labelled simulated suggestions. Delivery, returns and payment start as **Not decided yet** and stay unknown. "Skip and explore the demo" is always available.
2. **My marketing.** One prominent next action, a short simulated manager update, then four cards answering: what it is doing for me (goal and campaign journey), what needs approval, which customers are waiting, and how marketing is performing (three numbers, no charts).
3. **My plan.** Choose one of four goals, 1, 2 or 4 weeks, and a budget. A simulated "preparing" state (about 2 seconds) gives a plan with products, intended customer, main message and reason to buy, channels with reasons, five dated steps (discovery, styling, trust, purchase, follow-up), costs split into advertising, messaging and content, and success as ranges that guarantee nothing. You can edit it (message, audience, reason, name, length, daily ad amount, optional channels) with costs and dates recalculated, ask for a simulated alternative, discard or accept.
4. **Approvals.** The illustrative campaign "Dress confidently for your next occasion" has five items with lookbook photos labelled as demonstration material. Each item has channel previews (Instagram post, story or reel, Facebook post, ad, WhatsApp Status, WhatsApp message and others) with character limits, caption editing, alternative openings, simulated revisions, approve, and send back with a note. **Approval is tied to a version number.** Any change creates a new version and an approved item shows "Changed after approval, approve again".
5. **Campaigns.** "Schedule approved items", then use **Move forward a day** (the demo clock) to see what happens. Outcomes depend on each channel's demo connection, not on a button: Instagram is connected in demo and publishes, Facebook's connection has "expired" and fails with a fix (pretend reconnect, then "Try again now"), WhatsApp Status, reels and TikTok produce a **share pack** (copy caption, steps, "mark as shared"). The six states are awaiting approval, scheduled, published in demo, needs manual sharing, failed and paused. Pause stops publishing and ad spend, and Resume restarts them.
6. **Customers.** WhatsApp enquiries from fictional customers in New, Waiting for my reply, Follow-up due, Replied, Won and Lost. A banner contrasts taps on "Ask on WhatsApp" with real conversations. An enquiry shows the product, a sample conversation, the question, how they found you (tracked, customer said or unknown) and an editable simulated reply. Gaps for unknown policies (for example `[add your delivery price]`) block sending until filled. You can send a reply (demo), simulate the customer's answer, schedule a follow-up, record a sale once, or mark the enquiry lost. Unticking "Agreed to promotional messages" removes and blocks promotional follow-ups, and lowers the WhatsApp audience count.
7. **Results.** Per campaign, or "All sample activity". It shows the steps from reach to visits to enquiry clicks to confirmed enquiries to recorded sales, money (revenue and costs by type), where sales came from (tracked, customer said, unknown), repeat customers, and a channel table whose rows add up to the totals. A simulated plain-English review covers what works, where people drop off, what is uncertain, and what to try next. **Turn into next draft plan** prepares the next plan.
8. **Channels** (secondary). 24 channels grouped as social discovery, direct communication, search and catalogues, and partners and referrals. Each says what it helps with and what it needs, whether the prototype depicts automatic posting, manual sharing or a future idea, and its demo connection. Connect and disconnect are pretend, and say so.
9. **Business settings** (secondary). Edit the onboarding answers and policies, or rerun onboarding.

## Developer handoff

All code is in `src/components/prototype/marketing-manager/`. The page is `src/app/(prototype)/prototype/marketing-manager/page.tsx`.

| File | What it does |
| --- | --- |
| `types.ts` | The whole demo state (`DemoState`) and its records. |
| `catalog.ts` | Sample products (lookbook photos, sample prices), 24 channels, formats, starting demo connections, fixed sample result numbers and the example WhatsApp rate. |
| `seed.ts` | The prepared demo: example business, an earlier campaign with results, 9 sample customers, 8 enquiries and 5 sales, dated relative to the first visit. |
| `plan.ts` | Simulated planner and copywriter. Goals, plan templates and two variants per goal, cost maths (`planCosts`, `fitAdDaily`), schedule (`planSteps`), estimates, captions, openings and revisions. |
| `engine.ts` | One pure reducer for every action, plus summaries: `shownState`, `totals` (results as sums of records), `review`, `nextStep`, `managerUpdate`. |
| `store.tsx` | React context, `localStorage` persistence, hash router (`#/plan`, `#/approvals/m101` and so on), toasts. |
| `ui.tsx`, `previews.tsx` | Shared UI (pills, "Simulated" tag, dialog, notes) and channel previews. |
| `App.tsx` | Shell: prototype bar, desktop sidebar, mobile header and six-item bottom nav, Reset demo. |
| `screens/*` | One file per screen. |

**What is simulated, and how:**

- **"AI" output** (plans, captions, revisions, reply suggestions, manager update, review) comes from fixed templates and rules, with deliberate short delays. Everything is tagged "Simulated".
- **Publishing** runs in `runDay`/`attempt` in `engine.ts`. An item goes out only if it is approved, scheduled, due, not paused, and its channel is connected in demo. Otherwise it fails with a reason. Manual channels go to "needs manual sharing".
- **Results** are created only by events: an item going out adds an activity record with fixed sample numbers, ads add one record and one cost per running day, the WhatsApp follow-up adds a messaging cost per opted-in recipient, scheduling adds content costs, and recording a sale adds a sale. Scripted enquiries arrive when certain items go out.
- **Rules enforced in the reducer**, not only in the UI: approval must match the shown version, a sale is recorded once per enquiry, promo follow-ups are blocked for opted-out customers, unknown-source sales never get a campaign, and there is no ad spend while paused or beyond the plan's days.

Tests: `tests/marketing-manager-prototype.test.ts` (12 tests) covers budget and schedule consistency for every goal, period and variant, versioned approval, unapproved items never going out, failure and recovery, pause, the full period spending exactly the planned costs, sales counted once and totals reconciling, unknown-source attribution, opt-outs, and unknown policies never appearing in captions.

## Mapping to existing reusable code

| Prototype feature | Existing code it reuses or should map to later |
| --- | --- |
| Brand look | `globals.css` tokens and classes (`.card`, `.btn`, `.input`, `.badge`, `brand-*`), `Mark` from `components/storefront/Brand.tsx`, Cormorant and Jost, lookbook photos in `public/brand/lookbook/`. |
| Channel catalogue, character limits | `src/lib/marketing/channels.ts` (`getChannel` limits are used directly; `registryKind` links each prototype channel to the registry). Automatic vs manual mirrors the registry's `mode` and `apiNotes`. |
| Plan steps (discovery, trust, purchase, follow-up) | `src/lib/marketing/brief.ts` jobs (`GET_SEEN`, `EARN_TRUST`, `OFFER_CLOSE`, `KEEP`) and the selling profile and brief from PR 71. |
| Captions, openings, revisions | `src/lib/marketing/ai/writer.ts`, `ui.ts` `swapOpening`, and the draft checks. |
| Versioned approval | `src/lib/marketing/state.ts` post status machine (`PENDING_APPROVAL`, `APPROVED`, edit back to draft) and `approvedBy`/`approvedAt`. The prototype adds per-version approval, which the backend would need as a field. |
| Scheduling, publishing, failure | `publish.ts`, `flags.ts` `assertCanGoLive`, connectors in `src/lib/marketing/connectors/`, `npm run marketing:run`. |
| Manual share pack | The hub's share bundle and "Mark as shared" for manual channels. |
| Pretend connections | `connect.ts` and `CONNECT_FIELDS`. The real flow asks for tokens; the prototype deliberately shows none. |
| Customers and opt-outs | `contacts.ts`, `consent.ts`, `unsubscribe.ts`, WhatsApp Cloud messaging. |
| WhatsApp click vs conversation | Storefront `ProductEnquiry` and the `whatsapp_enquire` analytics event (clicks), against contacts and messages (conversations). |
| Tracked attribution | `?src=<trackingTag>` links (`tracking.ts`), `results.ts`. |
| Budget cap | `budget.ts` monthly spend cap. |

## Assumptions made

- Brand spelled **VYRA** (as in the repo), and the product is called "Marketing manager".
- Currency is USD, the delivery area is Harare, and ordering is through WhatsApp (from the storefront). Delivery, returns and payment are unknown.
- Prices on the five lookbook pieces are sample prices. The model photos are presented as demonstration material, never as customers.
- The WhatsApp rate ($0.04 a message) and the freelance video edit ($15) are illustrative and labelled.
- A new accepted plan ends the running campaign (one active campaign at a time).

## Known gaps and decisions for the owner

1. Should the real product run one campaign at a time, or several in parallel?
2. Should approval cover each channel version separately? Today one caption covers all formats of an item.
3. Delivery, returns and payment policies are needed before materials and replies can mention them.
4. Who answers WhatsApp (you, staff, or later an assistant), and how fast should a reply be promised?
5. Which channels to set up first. Facebook, Instagram and WhatsApp need Meta business verification and app review in a real launch.
6. Real budget and whether ad spend needs a second confirmation each time.
7. Not in the prototype: real AI, image or video generation, ad audiences, multi-shop accounts and sign-in, staff roles, notifications, offline data, and editing an accepted plan after it starts.

## Checks performed

- `npx tsc --noEmit`: clean for the new code. The only errors are the existing missing `xlsx` module, which this sandbox could not download.
- `npx eslint` on the new files: clean.
- `tests/marketing-manager-prototype.test.ts`: 12 of 12 pass. `tests/host-routing.test.ts`: 31 of 31 pass.
- Full journey in headless Chromium (Playwright) at 1366×900: onboarding with "Help me decide", plan, edit, alternative prompt, accept, open item, switch formats, approve, change opening, re-approve, send back, simulated revision, approve all, schedule, failure, pretend reconnect, retry, ten demo days, share pack with copy and mark shared, pause and resume, reply, record sale, opt-out blocking a promo follow-up, unknown-policy gap blocking send, results with rows adding up, recommendation to a new draft plan, channels, settings, and reload persistence. No console errors.
- Mobile (iPhone 13 emulation): onboarding, home, plan, approvals, item, campaigns, customers, enquiry, results, channels and the More menu. No horizontal overflow.
- Not run: `next build` (needs the `xlsx` package) and the database-backed test suites.
