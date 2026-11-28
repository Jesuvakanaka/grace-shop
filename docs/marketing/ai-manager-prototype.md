# AI Marketing Manager: clickable prototype

An isolated, clickable prototype of the owner experience for VYRA's AI Marketing Manager. It exists so the owner can use the intended product before any backend is built.

**Boundaries.** Fictional sample data only. No database changes, no migrations, no AI calls, no publishing, no customer messages, no ad spend, no real account connections. State lives in the visitor's browser (`localStorage` key `vyra-marketing-manager-prototype-v1`). A persistent bar on every screen says "Interactive prototype · Sample data · No real messages or spending." and carries **Reset demo**.

## Opening it

- Local: `npm install`, then `npm run dev`, then open <http://localhost:3000/prototype/marketing-manager>.
- On a deployed admin host (UAT) it would be at `/prototype/marketing-manager`. It is **not deployed**; deploying needs a separate instruction.
- No sign-in. The route sits in its own route group, `src/app/(prototype)/`, outside `(admin)`, because it reads no shop data. Pages carry `noindex`. On the storefront host the path is a 404 (host routing rewrites unknown paths to `/site/**`).

## Walkthrough of the main journey

1. **Understand my business.** First visit opens seven short questions with editable example answers: what you sell, who to reach, where you deliver, why choose you, policies, language and voice, budget. "Help me decide" offers labelled simulated suggestions. Delivery, returns and payment start as **Not decided yet** and stay unknown. "Skip and explore the demo" is always available.
2. **My marketing.** The manager is proactive: after onboarding (or skipping it) it prepares a recommended plan with its reason, so the first screen says, for example, "Two customers need your reply. I've also prepared your next campaign for review." with **Review replies** and **Review recommended plan**. Below are a short simulated manager update and four cards: what it is doing for me, what needs approval (including the plan and any ad spending), which customers are waiting, and how marketing is performing.
3. **My plan.** Opens on a compact decision card: goal, name, collection and message, why this plan, dates, cost against budget, channels and how many items you approve. Accept, Edit, Show me an alternative, **Change the goal** and Discard sit right there. Who it is for, channels (with how each format goes out), schedule, costs and **Illustrative demo outcomes** (labelled as sample numbers, not a forecast) are collapsed sections. With no plan, **Recommend a plan** or choose a goal, 1, 2 or 4 weeks and a budget. Accepting while a campaign is live asks one question: **Keep it, and start this plan afterwards** (recommended, nothing changes in the running campaign) or **Replace it now** (says how many unsent items are withdrawn and that ads stop).
4. **Approvals.** Every channel format is its own item with its own words, picture, look, storyboard and approval (the illustrative campaign has 8). Items are grouped by the five steps; each shows its format, status and how it goes out (Posted for you, You share it, Needs reconnecting). Batch approval (per step, or all) opens a list of every format and version it covers. Inside an item: the preview, links to the same step on other channels, caption editing, alternative openings, simulated revisions, send back with a note, and a **Picture** panel (choose any sample photo, four simulated looks drawn with CSS, Request a new visual) or, for reels and TikTok, a **Video storyboard** (photo, words on screen and seconds per scene, Regenerate storyboard). Every change is a new version; approval is tied to the version shown. The ad shows **Paid ad settings** beside it (who sees it, where, dates, daily amount, total limit, where a tap goes) with a separate **Approve paid ads** step that is only possible once the ad's content is approved.
5. **Campaigns.** "Schedule approved items", then use **Move forward a day** (the demo clock) to see what happens. Outcomes depend on each channel's demo connection, not on a button: Instagram is connected in demo and publishes, Facebook's connection has "expired" and fails with a fix (pretend reconnect, then "Try again now"), WhatsApp Status, reels and TikTok produce a **share pack** (copy caption, steps, "mark as shared"). The six states are awaiting approval, scheduled, published in demo, needs manual sharing, failed and paused. Pause stops publishing and ad spend, and Resume restarts them. Each row repeats how that format goes out, and an approved ad without spending approval shows "Ad spending not approved" and never runs. With two live campaigns, tabs switch between them.
6. **Customers.** WhatsApp enquiries from fictional customers in New, Waiting for my reply, Follow-up due, Replied, Won and Lost. A banner contrasts taps on "Ask on WhatsApp" with real conversations. An enquiry shows the product, a sample conversation, the question, how they found you (tracked, customer said or unknown) and an editable simulated reply. Gaps for unknown policies (for example `[add your delivery price]`) block sending until filled. You can send a reply (demo), simulate the customer's answer, schedule a follow-up, record a sale once, or mark the enquiry lost. Unticking "Agreed to promotional messages" removes and blocks promotional follow-ups, and lowers the WhatsApp audience count.
7. **Results.** Per campaign (live ones included), or "All sample activity". Steps from **combined reported reach** (labelled as possibly counting the same people more than once) to visits, enquiry clicks, **recorded conversations** and recorded sales; money with a plain sentence such as "Recorded revenue is currently $X below marketing costs, before product costs. The campaign is still running, and some sales may not have been recorded."; where sales came from; repeat customers; and a channel table whose rows add up. The simulated review no longer calls taps vs conversations a leak: it says conversations may be unrecorded and to "Check whether enquiries were recorded before changing the campaign." **Turn into next draft plan** prepares the next plan, and ending the last live campaign makes the manager recommend one.
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

Tests: `tests/marketing-manager-prototype.test.ts` (26 tests) covers budget and schedule consistency for every goal, period and variant, versioned approval, unapproved items never going out, failure and recovery, pause, the full period spending exactly the planned costs, sales counted once and totals reconciling, unknown-source attribution, opt-outs, unknown policies never appearing in captions, and from the review round: the recommended plan and changing its goal, keeping or replacing a live campaign, one material and approval per format with version-checked batch approval, ad spending needing its own approval, visual and storyboard changes creating versions, and the honest results wording.

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

1. Should a new campaign normally follow the current one (the prototype's default) or may several overlap? The prototype supports both, plus an explicit replace.
2. Per-format approval makes 8 approvals for one campaign. Is batch approval with a clear list enough, or should some formats inherit approval?
3. Delivery, returns and payment policies are needed before materials and replies can mention them.
4. Who answers WhatsApp (you, staff, or later an assistant), and how fast should a reply be promised?
5. Which channels to set up first. Facebook, Instagram and WhatsApp need Meta business verification and app review in a real launch.
6. Real budget, and whether ad spending approval should be needed once per campaign (as in the prototype) or again whenever the amount or audience changes.
7. Not in the prototype: real AI, real image or video generation (looks and storyboards are simulated), ad audiences, multi-shop accounts and sign-in, staff roles, notifications, offline data, and editing an accepted plan after it starts.

## Checks performed

- `npx tsc --noEmit`: clean for the new code. The only errors are the existing missing `xlsx` module, which this sandbox could not download.
- `npx eslint` on the new files: clean.
- `tests/marketing-manager-prototype.test.ts`: 12 of 12 pass. `tests/host-routing.test.ts`: 31 of 31 pass.
- Full journey in headless Chromium (Playwright) at 1366×900: onboarding with "Help me decide", plan, edit, alternative prompt, accept, open item, switch formats, approve, change opening, re-approve, send back, simulated revision, approve all, schedule, failure, pretend reconnect, retry, ten demo days, share pack with copy and mark shared, pause and resume, reply, record sale, opt-out blocking a promo follow-up, unknown-policy gap blocking send, results with rows adding up, recommendation to a new draft plan, channels, settings, and reload persistence. No console errors.
- Mobile (iPhone 13 emulation): onboarding, home, plan, approvals, item, campaigns, customers, enquiry, results, channels and the More menu. No horizontal overflow.
- Not run: `next build` (needs the `xlsx` package) and the database-backed test suites.

## Review round (outside reviewer)

What changed, and what was already handled or done differently:

| Review point | Before | Now |
| --- | --- | --- |
| Proactive home | Home said "Set your next marketing goal". | The manager prepares a recommended plan with its reason after onboarding and when the last campaign ends. Home leads with "Two customers need your reply. I've also prepared your next campaign for review." and both buttons. The goal stays changeable (**Change the goal**, or **Recommend a plan** / choose a goal). |
| Notifications stack over content | Up to three toasts stacked at the bottom centre for 4.5 s. | One notification at a time, small, bottom right (above the mobile nav), with a close button, gone after 3.5 s (6 s for warnings). Warnings that matter were already shown beside the item (failed placements, re-approval, unknown policies) and stay there. Redundant toasts after onboarding were removed. |
| Accepting a plan ended the running campaign | True, behind a confirm dialog. | The running campaign is kept by default; the new one starts the day after it ends. Replacing is a separate, explained choice. Several live campaigns are supported across Home, Approvals, Campaigns (tabs), Results and My plan. |
| One caption and approval covered several formats | True. | One material per format, each with its own words, picture, look, storyboard, versions and approval. Batch approval lists every format and version and skips any whose version changed. |
| Ad approval | Approving the ad item approved spending. | Paid ad settings beside the ad preview: audience, location, dates, daily amount, total limit, destination. Spending is a separate approval, possible only after the content is approved, and can be stopped. |
| "Biggest leak" | The review called 90 taps vs 2 conversations the biggest leak. | Plain wording that conversations may be unrecorded, ending "Check whether enquiries were recorded before changing the campaign." The recommendation that followed from it says the same. |
| Instagram "Posted for you" vs reels manual | Channel-level label in the plan. | Per-format label, the same in plan, approvals, item detail and campaign rows, and it also reflects the demo connection (for example, Facebook "Needs reconnecting"). |
| Long plan page | Everything expanded. | Compact decision card first; five collapsible sections with one-line summaries. |
| Visual production | Not present. | Simulated photo choice, four CSS looks, Request a new visual, and an editable video storyboard with Regenerate. No image or video is generated. |
| Results labels | "People reached"; ranges called success estimates. | "Combined reported reach (may include the same people more than once)", "Recorded conversations", a plain revenue-vs-costs sentence before product costs, and ranges labelled "Illustrative demo outcomes", not a forecast. |

Checks for this round: `tsc` clean apart from the existing `xlsx` error; ESLint clean; 18 of 18 prototype tests and 31 of 31 host-routing tests pass; a Playwright journey (desktop 1366×900 and iPhone 13) ran 22 checks covering each point above with no console errors and no horizontal overflow on mobile.

## Independent review round

Each finding was checked in the code first. All were confirmed except where noted.

| Finding | Now |
| --- | --- |
| Recommends the campaign already running | The recommendation looks at live and past campaigns, never repeats a goal that is live or the Occasion Edit once it has run, says when it would start ("It would start after X ends"), and says so if there is nothing new. The budget sentence was removed from the reason. |
| Campaigns never finish | A campaign ends on its own after its last day. Items that never went out are withdrawn, the manager update says it ended "yesterday" or "N days ago", and a next plan is recommended. Planned start dates are never before tomorrow. |
| Unknown-source sale invisible | Still not credited to a campaign (on purpose). Results and the home card now show "N other recorded sales in this campaign's dates ... not credited to this campaign", and the sale message says where it was counted. |
| "Only N people actually sent a message" | Reworded: taps tracked and conversations recorded, and some conversations may not have been recorded. The plan's "20 to 60 conversations" became the number of scripted conversations this demo actually produces. |
| Opt-out kept a promotional suggestion | Opting out swaps the promotional suggestion for a service reply, with a note; opting in restores it. |
| Unsupported statements | Ties are named as ties; the styling-video recommendation is written from the data; the budget sentence on alternative plans is gone. |
| Queue edge cases | Ending a campaign early moves the queued one forward to tomorrow. Replacing a campaign that has not started marks it "Cancelled before it started" and keeps its dates. |
| Revisions wear out | Warmer is not added twice, Shorter keeps hashtags and stops when nothing is left to cut, and the message says when nothing changed. |
| Smaller points | "Awaiting approval" counts only items waiting; "Ad spending not approved" and "Approved, not scheduled" have their own filters. Home warns to reconnect before an upcoming post on an expired channel. Resume runs items due today. Home says "and N more waiting", and the approvals card links to the plan when only a plan waits. The Follow-up due tab shows only due items and marks overdue ones. The mobile hero is smaller. Each storyboard uses one product's photo. |
| Found by reading the code | A published ad stops spending when its content is edited or sent back. Policy gaps in seeded replies are filled once the policy is entered. `material/approveAll` stays because the tests use it; the screens use the version-checked batch approval. |

Decisions left for Michael: whether campaigns queue (the prototype's default) or overlap; where unconnected sales should show; whether the ad's daily amount can change after a plan is accepted (today it is fixed by the plan).

Checks for this round: `tsc` clean apart from the existing `xlsx` error; ESLint clean; 26 of 26 prototype tests and 31 of 31 host-routing tests pass; the earlier 22-check Playwright journey still passes, plus 16 new browser checks for this round (desktop and iPhone 13), with no console errors and no mobile overflow.
