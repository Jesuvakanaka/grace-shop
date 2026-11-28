// AI Marketing Manager prototype: every state change, as one pure reducer, plus
// the read-only summaries the screens show. Nothing here talks to a server.
import { AD_DAILY_RESULTS_PER_DOLLAR, FORMAT_SAMPLE_RESULTS, FORMATS, WHATSAPP_RATE, channelById, productById, type ChannelId } from './catalog';
import { addDays, daysBetween, fmtDay, r2 } from './dates';
import { COLLECTIONS } from './catalog';
import { GOALS, buildMaterials, planSteps, buildPlan, planCosts, recipientsFor, revise, withOpening, type RevisionStyle } from './plan';
import type { Look, Scene, Version } from './types';
import { PREV_ID, seedState } from './seed';
import type {
  ActivityRecord, Business, Campaign, DemoState, Enquiry, GoalId, GoalInput, Material, Placement, Plan, Sale, Source,
} from './types';

export type Action =
  | { type: 'reset' }
  | { type: 'onboarding/finish'; business: Business }
  | { type: 'onboarding/skip' }
  | { type: 'onboarding/restart' }
  | { type: 'business/update'; business: Business }
  | { type: 'draft/start'; input: GoalInput }
  | { type: 'draft/plan'; variant: number }
  | { type: 'draft/edit'; plan: Plan }
  | { type: 'draft/discard' }
  | { type: 'draft/recommend' }
  /**
   * `after` (the default) keeps every live campaign and starts the new one when the last of them ends.
   * `alongside` starts it as planned, running at the same time. `replace` ends the live ones now.
   */
  | { type: 'draft/accept'; mode?: 'after' | 'alongside' | 'replace' }
  | { type: 'material/caption'; id: string; caption: string; why: string; by?: 'owner' | 'revision' }
  | { type: 'material/opening'; id: string; opening: string }
  | { type: 'material/revise'; id: string; style: RevisionStyle; why: string }
  | { type: 'material/visual'; id: string; patch: { images?: string[]; look?: Look; scenes?: Scene[] }; why: string; by?: 'owner' | 'revision' }
  | { type: 'material/approve'; id: string; version: number }
  /** Batch approval: only the listed items, each at the version the owner saw. */
  | { type: 'material/approveMany'; items: { id: string; version: number }[] }
  | { type: 'material/approveAll'; campaignId: string }
  | { type: 'material/sendBack'; id: string; note: string }
  | { type: 'campaign/schedule'; id: string }
  /** Starting paid ads is its own approval, separate from approving the ad's words and picture. */
  | { type: 'campaign/approveAds'; id: string; approved: boolean }
  | { type: 'campaign/pause'; id: string }
  | { type: 'campaign/resume'; id: string }
  | { type: 'campaign/end'; id: string }
  /** The owner accepts an earlier start the manager offered after another campaign ended early. */
  | { type: 'campaign/moveStart'; id: string; start: string }
  /** Change the daily ad amount after accepting. An increase needs `approved`. 0 stops paid ads. */
  | { type: 'campaign/adDaily'; id: string; daily: number; approved?: boolean }
  | { type: 'day/advance' }
  | { type: 'placement/retry'; id: string }
  | { type: 'placement/shared'; id: string }
  | { type: 'connection/set'; channel: ChannelId; status: 'connected' | 'not_connected' }
  | { type: 'enquiry/open'; id: string }
  | { type: 'enquiry/reply'; id: string; text: string; followUp?: Enquiry['followUp'] }
  | { type: 'enquiry/customerReplies'; id: string }
  | { type: 'enquiry/followUp'; id: string; followUp: Enquiry['followUp'] | null }
  | { type: 'enquiry/sale'; id: string; amount: number; source: Source }
  | { type: 'enquiry/lost'; id: string; reason: string }
  | { type: 'customer/optOut'; id: string; optedOut: boolean };

const nextId = (s: DemoState, prefix: string): [string, DemoState] => [`${prefix}${s.seq}`, { ...s, seq: s.seq + 1 }];

const log = (s: DemoState, text: string): DemoState => ({ ...s, log: [{ id: `l${s.seq}`, date: s.today, text }, ...s.log].slice(0, 60), seq: s.seq + 1 });

/** Campaigns that are running or waiting to start, earliest first. Several can be live at once. */
export const liveCampaigns = (s: DemoState): Campaign[] =>
  s.campaigns.filter((c) => c.status === 'active').sort((a, b) => a.startDate.localeCompare(b.startDate));

/** The live campaign that matters most now: the one already under way, else the next to start. */
export const activeCampaign = (s: DemoState): Campaign | undefined => liveCampaigns(s)[0];

export const currentVersion = (m: Material) => m.versions[m.versions.length - 1];

function updateMaterial(s: DemoState, id: string, fn: (m: Material) => Material): DemoState {
  return { ...s, materials: s.materials.map((m) => (m.id === id ? fn(m) : m)) };
}

type VersionPatch = Partial<Pick<Version, 'caption' | 'images' | 'look' | 'scenes'>>;

/** A new version of an item: words, picture, look or storyboard. If it was approved, it now needs approval again. */
function addVersion(m: Material, patch: VersionPatch, by: 'owner' | 'revision', why: string): Material {
  const cur = currentVersion(m);
  const next: Version = { ...cur, ...patch, n: cur.n + 1, by, why };
  if (JSON.stringify({ ...cur, n: 0, by: '', why: '' }) === JSON.stringify({ ...next, n: 0, by: '', why: '' })) return m;
  return {
    ...m,
    versions: [...m.versions, next],
    status: 'awaiting',
    reapproval: m.status === 'approved' || m.reapproval,
    backNote: m.status === 'changes' ? m.backNote : undefined,
  };
}

// --------------------------------------------------------------- publishing

/** Scripted enquiries that arrive when a demo item goes out. Each arrives once. */
const ARRIVALS: Partial<Record<string, { key: string; name: string; productIndex: number; text: string; question: string; suggestion: string }>> = {
  'discovery:ig_post': {
    key: 'tsitsi', name: 'Tsitsi R.', productIndex: 0,
    text: 'Hi, I saw your post. I have a wedding on the 20th. Would the lime dress work for a size 12 and is it too bright for a wedding guest?',
    question: 'Size 12, and is the lime colour right for a wedding guest?',
    suggestion: 'Hi Tsitsi, congratulations on the wedding invitation! The lime dress is a wonderful wedding-guest colour, bright but elegant. A size 12 fits a UK 12 with room at the waist thanks to the belt. Would you like me to reserve one?',
  },
  'invite:ig_story': {
    key: 'patience', name: 'Patience H.', productIndex: 2,
    text: 'Hello! Saw your story. Do you have the bronze set in medium? It’s for my graduation.',
    question: 'Is the bronze set available in medium?',
    suggestion: 'Hi Patience, congratulations on your graduation! Yes, we have the bronze set in medium. Shall I send you the details to order?',
  },
  'invite:wa_status': {
    key: 'linda', name: 'Linda Z.', productIndex: 1,
    text: 'Hi, is the olive print dress long? I’m quite tall.',
    question: 'How long is the olive print dress?',
    suggestion: 'Hi Linda, the olive print dress falls just below the knee on most people. If you send me your height I can tell you exactly where it would sit.',
  },
};

function arrive(s: DemoState, c: Campaign, m: Material, p: Placement): DemoState {
  const a = ARRIVALS[`${m.stage}:${p.format}`];
  if (!a) return s;
  const id = `e-${c.id}-${a.key}`;
  if (s.enquiries.some((e) => e.id === id)) return s;
  const customerId = `cu-${c.id}-${a.key}`;
  const channel = FORMATS[p.format].channel;
  const productId = c.plan.productIds[a.productIndex % c.plan.productIds.length];
  const e: Enquiry = {
    id, customerId, productId, campaignId: c.id,
    source: { kind: 'tracked', channel, detail: `Came through the tracked link on the ${FORMATS[p.format].label.toLowerCase()}.` },
    stage: 'new', created: s.today,
    messages: [{ from: 'customer', date: s.today, text: a.text }],
    question: a.question, suggestedReply: a.suggestion, script: [],
  };
  return {
    ...s,
    customers: s.customers.some((x) => x.id === customerId) ? s.customers : [...s.customers, { id: customerId, name: a.name, marketingOk: false }],
    enquiries: [e, ...s.enquiries],
  };
}

function goesOut(s: DemoState, p: Placement, byOwner: boolean): DemoState {
  if (!withinCampaign(s, p.campaignId)) return s;
  const m = s.materials.find((x) => x.id === p.materialId)!;
  const c = s.campaigns.find((x) => x.id === p.campaignId)!;
  const channel = FORMATS[p.format].channel;
  s = { ...s, placements: s.placements.map((x) => (x.id === p.id ? { ...x, state: 'published', publishedVersion: m.approvedVersion ?? undefined, sharedByOwner: byOwner, failReason: undefined } : x)) };
  const sample = FORMAT_SAMPLE_RESULTS[p.format];
  let rec: ActivityRecord | null = null;
  if (p.format === 'wa_message') {
    const recipients = recipientsFor(s.customers);
    rec = { id: `a${s.seq}`, date: s.today, campaignId: c.id, channel, placementId: p.id, reach: recipients, visits: 9, clicks: 3 };
    s = { ...s, seq: s.seq + 1, costs: [...s.costs, { id: `k${s.seq}`, date: s.today, campaignId: c.id, kind: 'messaging', amount: r2(recipients * WHATSAPP_RATE), note: `${recipients} people who agreed to WhatsApp messages, at an example rate of $${WHATSAPP_RATE.toFixed(2)} each` }] };
  } else if (p.format !== 'ad') {
    rec = { id: `a${s.seq}`, date: s.today, campaignId: c.id, channel, placementId: p.id, ...sample };
  }
  if (rec) s = { ...s, seq: s.seq + 1, activity: [...s.activity, rec] };
  s = log(s, byOwner
    ? `You marked "${m.title}" as shared on ${FORMATS[p.format].label} (demo).`
    : `"${m.title}" was published in the demo on ${FORMATS[p.format].label}. Nothing was posted for real.`);
  return arrive(s, c, m, p);
}

/** A running ad shows only an approved version: after re-approval, it switches to that version. */
function syncPublished(s: DemoState): DemoState {
  for (const p of s.placements.filter((x) => x.format === 'ad' && x.state === 'published')) {
    const m = s.materials.find((x) => x.id === p.materialId);
    if (!m || m.status !== 'approved' || m.approvedVersion == null || m.approvedVersion === p.publishedVersion || !withinCampaign(s, p.campaignId)) continue;
    s = log({ ...s, placements: s.placements.map((x) => (x.id === p.id ? { ...x, publishedVersion: m.approvedVersion! } : x)) },
      `The running ad now shows version ${m.approvedVersion}, the one you approved.`);
  }
  return s;
}

/** Nothing goes out for a campaign that has ended, or outside its dates. */
export function withinCampaign(s: DemoState, campaignId: string): boolean {
  const c = s.campaigns.find((x) => x.id === campaignId);
  return !!c && c.status === 'active' && s.today >= c.startDate && s.today <= c.endDate;
}

function attempt(s: DemoState, p: Placement): DemoState {
  if (!withinCampaign(s, p.campaignId)) return s;
  const f = FORMATS[p.format];
  if (!f.auto) {
    return { ...s, placements: s.placements.map((x) => (x.id === p.id ? { ...x, state: 'manual' } : x)) };
  }
  const conn = s.connections[f.channel];
  if (conn === 'connected') return goesOut(s, p, false);
  const reason = conn === 'expired'
    ? `The ${channelById(f.channel).name} connection has expired (demo). Reconnect it, then try again.`
    : `${channelById(f.channel).name} is not connected in the demo. Connect it, then try again.`;
  s = { ...s, placements: s.placements.map((x) => (x.id === p.id ? { ...x, state: 'failed', failReason: reason, failures: (x.failures ?? 0) + 1 } : x)) };
  return log(s, `"${s.materials.find((m) => m.id === p.materialId)?.title}" could not go out on ${f.label}: ${reason}`);
}

/** Sends out one campaign's approved items that are due today or overdue. */
function runDue(s: DemoState, c: Campaign): DemoState {
  const due = s.placements.filter((p) => {
    if (p.campaignId !== c.id || p.state !== 'scheduled' || p.date > s.today) return false;
    const m = s.materials.find((x) => x.id === p.materialId);
    // An ad waits until paid activity is approved, even when its content is approved.
    if (p.format === 'ad' && !c.adApproved) return false;
    return m?.status === 'approved';
  });
  for (const p of due) s = attempt(s, p);
  return s;
}

/** Moves a campaign that has not started to a new start date, with its items. */
function shiftCampaign(s: DemoState, id: string, start: string): DemoState {
  const c = s.campaigns.find((x) => x.id === id);
  if (!c || c.startDate === start) return s;
  const d = daysBetween(c.startDate, start);
  return {
    ...s,
    campaigns: s.campaigns.map((x) => (x.id === id ? { ...x, startDate: start, endDate: addDays(x.endDate, d), plan: { ...x.plan, startDate: start } } : x)),
    materials: s.materials.map((m) => (m.campaignId === id ? { ...m, date: addDays(m.date, d) } : m)),
    placements: s.placements.map((p) => (p.campaignId === id && p.state !== 'published' ? { ...p, date: addDays(p.date, d) } : p)),
  };
}

/**
 * After a campaign stops early, a queued campaign could start sooner. It is never moved on its
 * own: the earlier date is offered and the owner decides.
 */
export function earlierStarts(s: DemoState): { id: string; name: string; from: string; to: string }[] {
  const out: { id: string; name: string; from: string; to: string }[] = [];
  let cursor = addDays(s.today, 1);
  for (const c of [...liveCampaigns(s)].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    if (c.startDate <= s.today) { cursor = [cursor, addDays(c.endDate, 1)].sort().at(-1)!; continue; }
    const start = c.startDate > cursor ? cursor : c.startDate;
    if (start !== c.startDate) out.push({ id: c.id, name: c.name, from: c.startDate, to: start });
    cursor = [cursor, addDays(start, c.plan.days)].sort().at(-1)!;
  }
  return out;
}

/** What changing the daily ad amount would mean, shown before the owner confirms. */
export function adChangeQuote(s: DemoState, c: Campaign, daily: number) {
  const ads = s.costs.filter((k) => k.campaignId === c.id && k.kind === 'ads');
  const spent = r2(ads.reduce((n, k) => n + k.amount, 0));
  const spentToday = ads.some((k) => k.date === s.today);
  const firstDay = [c.startDate, spentToday ? addDays(s.today, 1) : s.today].sort().at(-1)!;
  const daysLeft = firstDay > c.endDate ? 0 : Math.min(daysBetween(firstDay, c.endDate) + 1, Math.max(0, c.plan.days - ads.length));
  const planned = planCosts(c.plan, recipientsFor(s.customers));
  const other = r2(planned.content + planned.messaging);
  const remaining = r2(daily * daysLeft);
  return {
    spent, daysLeft, remaining, other,
    currentRemaining: r2(c.plan.adDaily * daysLeft),
    revisedTotal: r2(spent + remaining + other),
    currentTotal: r2(spent + c.plan.adDaily * daysLeft + other),
    budget: c.plan.budget,
    increase: daily > c.plan.adDaily,
  };
}

/**
 * Stops a campaign. `finished` is its natural end. A campaign stopped before its first day is
 * marked cancelled and keeps its planned dates, so no end date falls before its start.
 */
function closeCampaign(s: DemoState, id: string, how: 'finished' | 'ended' | 'replaced'): DemoState {
  const c = s.campaigns.find((x) => x.id === id);
  if (!c || c.status !== 'active') return s;
  const started = c.startDate <= s.today;
  const unsent = s.placements.filter((p) => p.campaignId === id && p.state !== 'published').length;
  s = {
    ...s,
    campaigns: s.campaigns.map((x) => (x.id === id ? {
      ...x, status: 'ended' as const, paused: false, cancelled: !started,
      endDate: how === 'finished' || !started ? x.endDate : (x.endDate < s.today ? x.endDate : s.today),
    } : x)),
    // Items that never went out are withdrawn.
    placements: s.placements.filter((p) => p.campaignId !== id || p.state === 'published'),
  };
  const withdrawn = unsent ? ` ${unsent} item${unsent === 1 ? ' that had not gone out was' : 's that had not gone out were'} withdrawn.` : '';
  const text = how === 'finished'
    ? `"${c.name}" finished on its last day, ${fmtDay(c.endDate)}.${withdrawn}`
    : !started ? `"${c.name}" was cancelled before it started.` : how === 'replaced' ? `"${c.name}" was ended to make way for a new plan.${withdrawn}` : `You ended "${c.name}".${withdrawn}`;
  return log(s, text);
}

function runDay(s: DemoState): DemoState {
  // Campaigns past their last day finish first, so nothing of theirs goes out after the end.
  const done = s.campaigns.filter((c) => c.status === 'active' && c.endDate < s.today);
  for (const c of done) s = closeCampaign(s, c.id, 'finished');
  for (const c of s.campaigns.filter((x) => x.status === 'active' && x.scheduled && !x.paused)) {
    s = runDue(s, c);
    // A running ad spends its daily amount each day, and reports its reach daily. It stops if
    // its content is no longer approved (edited or sent back) or spending is withdrawn.
    const ad = s.placements.find((p) => p.campaignId === c.id && p.format === 'ad' && p.state === 'published');
    const adOk = ad && s.materials.find((m) => m.id === ad.materialId)?.status === 'approved';
    if (ad && adOk && c.adApproved && c.plan.adDaily > 0 && s.today <= c.endDate) {
      const spentDays = s.costs.filter((k) => k.campaignId === c.id && k.kind === 'ads').length;
      if (spentDays < c.plan.days && !s.costs.some((k) => k.campaignId === c.id && k.kind === 'ads' && k.date === s.today)) {
        const d = c.plan.adDaily;
        const shownVersion = ad.publishedVersion ?? 1;
        s = {
          ...s,
          seq: s.seq + 2,
          costs: [...s.costs, { id: `k${s.seq}`, date: s.today, campaignId: c.id, kind: 'ads', amount: d, note: `One day of ads at $${d} a day, ad version ${shownVersion} (pretend spending)` }],
          activity: [...s.activity, {
            id: `a${s.seq + 1}`, date: s.today, campaignId: c.id, channel: 'meta_ads', placementId: ad.id,
            reach: Math.round(d * AD_DAILY_RESULTS_PER_DOLLAR.reach), visits: Math.round(d * AD_DAILY_RESULTS_PER_DOLLAR.visits), clicks: Math.round(d * AD_DAILY_RESULTS_PER_DOLLAR.clicks),
          }],
        };
      }
    }
  }
  // Nothing is live any more: the manager reads the results and prepares the next plan.
  if (done.length && !liveCampaigns(s).length) s = recommend(s, done[done.length - 1].id);
  return s;
}

// --------------------------------------------------------------- recommendations

/**
 * The manager prepares the next plan on its own, so the owner reviews a proposal instead of
 * starting from a blank goal. Simulated: fixed rules over the sample records. The owner can
 * still change the goal or discard it.
 */
function recommend(s: DemoState, fromCampaign?: string): DemoState {
  if (s.draft) return s;
  let input: GoalInput;
  let reason: string;
  const live = liveCampaigns(s);
  const ran = s.campaigns.filter((c) => !c.cancelled);
  const occasionDone = ran.some((c) => c.plan.collectionName === COLLECTIONS.occasion.name);
  // The campaign whose results the recommendation reads: the one named, else the one under way, else the last one.
  const basis = (fromCampaign ? s.campaigns.find((c) => c.id === fromCampaign) : undefined)
    ?? live.find((c) => c.startDate <= s.today)
    ?? [...ran].filter((c) => c.status === 'ended').sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const lastLive = [...live].sort((a, b) => a.endDate.localeCompare(b.endDate)).at(-1);
  const after = lastLive ? ` It would start after "${lastLive.name}" ends on ${fmtDay(lastLive.endDate)}.` : '';
  if (!occasionDone && !fromCampaign) {
    input = { goal: 'collection', weeks: 2, budget: Math.round(s.business.monthlyBudget / 2), fromRecommendation: 'Promote the Occasion Edit' };
    reason = `The Occasion Edit has not been promoted yet and occasion season is coming.${basis && basis.id === PREV_ID ? ' In your last campaign, Instagram brought the most taps on "Ask on WhatsApp", so this plan leads with Instagram posts.' : ''}${after}`;
  } else {
    if (!basis) return s;
    const goalsLive = new Set(live.map((c) => c.goal));
    const r = review(s, totals(s, basis.id), basis.id).next.find((x) => !goalsLive.has(x.input.goal) && !(x.input.goal === 'collection' && occasionDone));
    // Nothing that is not already planned: say so rather than repeat a running campaign.
    if (!r) return log(s, 'Your marketing manager found nothing new to recommend: your live campaigns already cover the useful goals.');
    input = r.input;
    reason = `Based on how "${basis.name}" ${basis.status === 'active' ? 'is going so far' : 'went'}. ${r.why}${after}`;
  }
  const plan = buildPlan(input, s.business, s.today, 0, recipientsFor(s.customers));
  const named = live.some((c) => c.name === plan.name) ? { ...plan, name: `${plan.name}: next round` } : plan;
  return log({ ...s, draft: { input, plan: named, recommended: reason } }, `Your marketing manager prepared a recommended plan, "${named.name}", for you to review (simulated).`);
}

// --------------------------------------------------------------- reducer

export function reducer(s: DemoState, a: Action): DemoState {
  switch (a.type) {
    case 'reset':
      return seedState();
    case 'onboarding/finish':
      return recommend(log({ ...s, onboarding: 'done', business: a.business }, 'You finished telling us about your business.'));
    case 'onboarding/skip':
      return recommend({ ...s, onboarding: 'skipped' });
    case 'draft/recommend':
      return recommend(s);
    case 'onboarding/restart':
      return { ...s, onboarding: 'pending' };
    case 'business/update':
      return log({ ...s, business: a.business }, 'You updated your business details.');

    case 'draft/start':
      // The owner chose a goal: this is now their plan, not a recommendation.
      return { ...s, draft: { input: a.input, plan: null } };
    case 'draft/plan': {
      if (!s.draft) return s;
      const plan = buildPlan(s.draft.input, s.business, s.today, a.variant, recipientsFor(s.customers));
      return { ...s, draft: { ...s.draft, plan } };
    }
    case 'draft/edit':
      return s.draft ? { ...s, draft: { ...s.draft, plan: a.plan } } : s;
    case 'draft/discard':
      return { ...s, draft: null };
    case 'draft/accept': {
      let plan = s.draft?.plan;
      if (!plan) return s;
      const live = liveCampaigns(s);
      const mode = a.mode ?? 'after';
      // A plan prepared on an earlier demo day never starts in the past.
      if (plan.startDate <= s.today) plan = { ...plan, startDate: addDays(s.today, 1) };
      // Keeping what is running: the new campaign starts the day after the last live one ends.
      // `alongside` keeps the planned start, so both run at the same time.
      if (mode === 'after' && live.length) {
        const lastEnd = live.map((c) => c.endDate).sort().at(-1)!;
        const start = addDays(lastEnd, 1);
        if (plan.startDate < start) plan = { ...plan, startDate: start };
      }
      const endedIds = new Set(mode === 'replace' ? live.map((c) => c.id) : []);
      let n = s;
      // Replacing finishes the live campaigns now; their records stay in the results.
      for (const id of endedIds) n = closeCampaign(n, id, 'replaced');
      const [cid, first] = nextId(n, 'c');
      n = {
        ...first,
        campaigns: [...first.campaigns,
          { id: cid, name: plan.name, goal: plan.goal, plan, status: 'active', startDate: plan.startDate, endDate: addDays(plan.startDate, plan.days - 1), scheduled: false, paused: false, adApproved: false }],
      };
      const mats = buildMaterials(plan, n.business, cid, n.seq);
      n = { ...n, seq: n.seq + mats.length, materials: [...n.materials, ...mats] };
      const placements: Placement[] = [];
      for (const m of mats) for (const f of m.formats) placements.push({ id: `${m.id}-${f}`, campaignId: cid, materialId: m.id, format: f, date: m.date, state: 'scheduled' });
      n = { ...n, placements: [...n.placements, ...placements], draft: null };
      const when = !live.length ? '' : mode === 'after' ? ` It starts on ${fmtDay(plan.startDate)}, after your current campaign.` : mode === 'alongside' ? ` It starts on ${fmtDay(plan.startDate)} and runs alongside your current campaign.` : '';
      return log(n, `You accepted the plan "${plan.name}". ${mats.length} items are ready for your approval.${when}`);
    }

    case 'material/caption':
      return updateMaterial(s, a.id, (m) => addVersion(m, { caption: a.caption }, a.by ?? 'owner', a.why));
    case 'material/opening':
      return updateMaterial(s, a.id, (m) => addVersion(m, { caption: withOpening(currentVersion(m).caption, a.opening) }, 'owner', 'You chose a different opening'));
    case 'material/revise':
      return updateMaterial(s, a.id, (m) => ({ ...addVersion(m, { caption: revise(currentVersion(m).caption, a.style) }, 'revision', a.why), backNote: undefined }));
    case 'material/visual':
      return updateMaterial(s, a.id, (m) => addVersion(m, a.patch, a.by ?? 'owner', a.why));
    case 'material/approve': {
      const m = s.materials.find((x) => x.id === a.id);
      // Approval applies only to the version the owner was looking at.
      if (!m || currentVersion(m).n !== a.version) return s;
      return syncPublished(log(updateMaterial(s, a.id, (x) => ({ ...x, status: 'approved', approvedVersion: a.version, reapproval: false, backNote: undefined })), `You approved "${m.title}" (version ${a.version}).`));
    }
    case 'material/approveMany': {
      // Each item is approved only if the owner saw its current version.
      const ok = a.items.filter((it) => {
        const m = s.materials.find((x) => x.id === it.id);
        return m && m.status !== 'approved' && currentVersion(m).n === it.version;
      });
      if (!ok.length) return s;
      const ids = new Map(ok.map((it) => [it.id, it.version]));
      return syncPublished(log({ ...s, materials: s.materials.map((m) => (ids.has(m.id) ? { ...m, status: 'approved', approvedVersion: ids.get(m.id)!, reapproval: false, backNote: undefined } : m)) }, `You approved ${ok.length} item${ok.length === 1 ? '' : 's'} as shown.`));
    }
    case 'material/approveAll': {
      const list = s.materials.filter((m) => m.campaignId === a.campaignId && m.status === 'awaiting');
      if (!list.length) return s;
      const ids = new Set(list.map((m) => m.id));
      return log({ ...s, materials: s.materials.map((m) => (ids.has(m.id) ? { ...m, status: 'approved', approvedVersion: currentVersion(m).n, reapproval: false } : m)) }, `You approved ${list.length} items as shown.`);
    }
    case 'material/sendBack': {
      const m = s.materials.find((x) => x.id === a.id);
      if (!m) return s;
      return log(updateMaterial(s, a.id, (x) => ({ ...x, status: 'changes', backNote: a.note, approvedVersion: null })), `You sent "${m.title}" back for changes.`);
    }

    case 'campaign/schedule': {
      const c = s.campaigns.find((x) => x.id === a.id);
      if (!c || c.scheduled) return s;
      let n: DemoState = { ...s, campaigns: s.campaigns.map((x) => (x.id === a.id ? { ...x, scheduled: true } : x)) };
      for (const item of c.plan.content.filter((x) => x.cost > 0)) {
        n = { ...n, seq: n.seq + 1, costs: [...n.costs, { id: `k${n.seq}`, date: n.today, campaignId: c.id, kind: 'content', amount: item.cost, note: item.label }] };
      }
      return log(n, `You scheduled "${c.name}". Approved items go out on their planned days.`);
    }
    case 'campaign/approveAds': {
      const c = s.campaigns.find((x) => x.id === a.id);
      const ad = s.materials.find((m) => m.campaignId === a.id && m.formats[0] === 'ad');
      // Spending can only be approved once the ad itself is approved, exactly as shown.
      if (!c || !ad || (a.approved && ad.status !== 'approved')) return s;
      return log({ ...s, campaigns: s.campaigns.map((x) => (x.id === a.id ? { ...x, adApproved: a.approved } : x)) },
        a.approved ? `You approved paid ads for "${c.name}": up to $${c.plan.adDaily} a day, $${r2(c.plan.adDaily * c.plan.days)} in total (pretend spending).` : `You stopped paid ads for "${c.name}". No more ad spending.`);
    }
    case 'campaign/pause':
      return log({
        ...s,
        campaigns: s.campaigns.map((c) => (c.id === a.id ? { ...c, paused: true } : c)),
        placements: s.placements.map((p) => (p.campaignId === a.id && p.state === 'scheduled' ? { ...p, state: 'paused' } : p)),
      }, 'You paused the campaign. Nothing new goes out and ads stop spending.');
    case 'campaign/resume': {
      let n = log({
        ...s,
        campaigns: s.campaigns.map((c) => (c.id === a.id ? { ...c, paused: false } : c)),
        placements: s.placements.map((p) => (p.campaignId === a.id && p.state === 'paused' ? { ...p, state: 'scheduled' } : p)),
      }, 'You resumed the campaign.');
      // Anything due today goes out now, not tomorrow.
      const c = n.campaigns.find((x) => x.id === a.id);
      if (c?.scheduled && c.status === 'active') n = runDue(n, c);
      return n;
    }
    case 'campaign/end': {
      let n = closeCampaign(s, a.id, 'ended');
      for (const o of earlierStarts(n)) n = log(n, `"${o.name}" could now start earlier, on ${fmtDay(o.to)} instead of ${fmtDay(o.from)}. It stays on its planned date unless you choose to move it.`);
      // Nothing else is live: the manager prepares the next plan for review.
      return liveCampaigns(n).length ? n : recommend(n, a.id);
    }
    case 'campaign/moveStart': {
      const offer = earlierStarts(s).find((o) => o.id === a.id && o.to === a.start);
      if (!offer) return s;
      return log(shiftCampaign(s, a.id, a.start), `You moved "${offer.name}" to start on ${fmtDay(a.start)}.`);
    }
    case 'campaign/adDaily': {
      const c = s.campaigns.find((x) => x.id === a.id);
      const daily = r2(a.daily);
      if (!c || c.status !== 'active' || !(daily >= 0) || daily === c.plan.adDaily) return s;
      // Spending more always needs the owner's explicit approval.
      if (daily > c.plan.adDaily && !a.approved) return s;
      const q = adChangeQuote(s, c, daily);
      const adOk = s.materials.find((m) => m.campaignId === c.id && m.formats[0] === 'ad')?.status === 'approved';
      const n = { ...s, campaigns: s.campaigns.map((x) => (x.id === a.id ? { ...x, plan: { ...x.plan, adDaily: daily }, adApproved: daily === 0 ? false : x.plan.adDaily === 0 ? adOk : x.adApproved } : x)) };
      return log(n, daily === 0
        ? `You stopped paid ads for "${c.name}". $${q.spent} was spent; nothing more will be.`
        : `You changed the ads for "${c.name}" from $${c.plan.adDaily} to $${daily} a day. Up to $${q.remaining} more over ${q.daysLeft} day${q.daysLeft === 1 ? '' : 's'}; revised total $${q.revisedTotal} against a $${q.budget} budget.`);
    }
    case 'day/advance':
      return runDay({ ...s, today: addDays(s.today, 1) });
    case 'placement/retry': {
      const p = s.placements.find((x) => x.id === a.id);
      if (!p || p.state !== 'failed') return s;
      const c = s.campaigns.find((x) => x.id === p.campaignId);
      if (c?.paused) return s;
      return attempt(s, p);
    }
    case 'placement/shared': {
      const p = s.placements.find((x) => x.id === a.id);
      if (!p || p.state !== 'manual') return s;
      return goesOut(s, p, true);
    }
    case 'connection/set':
      return log({ ...s, connections: { ...s.connections, [a.channel]: a.status } },
        a.status === 'connected'
          ? `${channelById(a.channel).name} pretend-connected for the demo. No real account was contacted.`
          : `${channelById(a.channel).name} disconnected in the demo.`);

    case 'enquiry/open':
      return { ...s, enquiries: s.enquiries.map((e) => (e.id === a.id && e.stage === 'new' ? { ...e, stage: 'waiting' } : e)) };
    case 'enquiry/reply': {
      const e = s.enquiries.find((x) => x.id === a.id);
      if (!e) return s;
      const customer = s.customers.find((c) => c.id === e.customerId);
      const fu = a.followUp?.kind === 'promo' && !customer?.marketingOk ? undefined : a.followUp;
      const closed = e.stage === 'won' || e.stage === 'lost';
      return log({
        ...s,
        enquiries: s.enquiries.map((x) => (x.id === a.id ? {
          ...x,
          stage: closed ? x.stage : 'replied',
          messages: [...x.messages, { from: 'shop', text: a.text, date: s.today }],
          followUp: fu ?? (x.followUp && x.followUp.date <= s.today ? undefined : x.followUp),
          suggestedReply: '',
        } : x)),
      }, `You replied to ${customer?.name ?? 'a customer'} (demo, nothing was sent).`);
    }
    case 'enquiry/customerReplies': {
      const e = s.enquiries.find((x) => x.id === a.id);
      const next = e?.script[0];
      if (!e || !next) return s;
      return {
        ...s,
        enquiries: s.enquiries.map((x) => (x.id === a.id ? {
          ...x, stage: x.stage === 'won' || x.stage === 'lost' ? x.stage : 'waiting',
          messages: [...x.messages, { from: 'customer', text: next.customer, date: s.today }],
          question: next.question, suggestedReply: next.suggestion, script: x.script.slice(1),
        } : x)),
      };
    }
    case 'enquiry/followUp': {
      const e = s.enquiries.find((x) => x.id === a.id);
      const customer = s.customers.find((c) => c.id === e?.customerId);
      // An opt-out blocks promotional follow-ups, whatever the screen sends.
      if (a.followUp?.kind === 'promo' && !customer?.marketingOk) return s;
      return { ...s, enquiries: s.enquiries.map((x) => (x.id === a.id ? { ...x, followUp: a.followUp ?? undefined } : x)) };
    }
    case 'enquiry/sale': {
      const e = s.enquiries.find((x) => x.id === a.id);
      // One sale per enquiry: a second press changes nothing.
      if (!e || e.saleId || !(a.amount > 0)) return s;
      const [sid, n] = nextId(s, 's');
      const sale: Sale = {
        id: sid, date: n.today, customerId: e.customerId, productId: e.productId, amount: r2(a.amount), enquiryId: e.id,
        campaignId: a.source.kind === 'unknown' ? null : e.campaignId,
        source: a.source,
      };
      const name = n.customers.find((c) => c.id === e.customerId)?.name ?? 'a customer';
      return log({
        ...n,
        sales: [...n.sales, sale],
        enquiries: n.enquiries.map((x) => (x.id === e.id ? { ...x, stage: 'won', saleId: sid, followUp: x.followUp?.kind === 'promo' ? undefined : x.followUp } : x)),
      }, `You recorded a demo sale of $${sale.amount} to ${name}.`);
    }
    case 'enquiry/lost':
      return { ...s, enquiries: s.enquiries.map((x) => (x.id === a.id && !x.saleId ? { ...x, stage: 'lost', lostReason: a.reason, followUp: undefined } : x)) };
    case 'customer/optOut': {
      const name = s.customers.find((c) => c.id === a.id)?.name ?? 'Customer';
      return log({
        ...s,
        customers: s.customers.map((c) => (c.id === a.id ? { ...c, marketingOk: !a.optedOut } : c)),
        // Opting out removes any promotional follow-up and swaps a promotional suggested reply
        // for a plain service one; opting back in restores it.
        enquiries: s.enquiries.map((e) => {
          if (e.customerId !== a.id) return e;
          if (a.optedOut) {
            const first = name.split(' ')[0];
            const swap = e.suggestionPromo ? { suggestedReply: `Hi ${first}, thank you for your message. Let us know if there is anything we can help you with.`, heldPromoReply: e.suggestedReply, suggestionPromo: false } : {};
            return { ...e, ...swap, followUp: e.followUp?.kind === 'promo' ? undefined : e.followUp };
          }
          return e.heldPromoReply ? { ...e, suggestedReply: e.heldPromoReply, heldPromoReply: undefined, suggestionPromo: true } : e;
        }),
      }, a.optedOut ? `${name} opted out of promotional messages.` : `${name} agreed to promotional messages again.`);
    }
  }
}

// --------------------------------------------------------------- read-only summaries

export type ShownState = 'awaiting' | 'spend' | 'ready' | 'scheduled' | 'published' | 'manual' | 'failed' | 'paused';

export const SHOWN_LABEL: Record<ShownState, string> = {
  awaiting: 'Awaiting approval',
  spend: 'Ad spending not approved',
  ready: 'Approved, not scheduled',
  scheduled: 'Scheduled',
  published: 'Published in demo',
  manual: 'Needs manual sharing',
  failed: 'Failed',
  paused: 'Paused',
};

/** What the owner sees for a placement. Unapproved items never count as scheduled. */
export function shownState(s: DemoState, p: Placement): ShownState {
  if (p.state === 'published') return 'published';
  const m = s.materials.find((x) => x.id === p.materialId);
  if (!m || m.status !== 'approved') return 'awaiting';
  const c = s.campaigns.find((x) => x.id === p.campaignId);
  if (p.format === 'ad' && !c?.adApproved) return 'spend';
  if (!c?.scheduled) return 'ready';
  return p.state;
}

export interface Totals {
  reach: number;
  visits: number;
  clicks: number;
  enquiries: number;
  sales: number;
  revenue: number;
  costs: { ads: number; messaging: number; content: number; total: number };
  repeatCustomers: number;
  bySource: Record<'tracked' | 'reported' | 'unknown', { sales: number; revenue: number; enquiries: number }>;
  rows: { key: string; label: string; reach: number; visits: number; clicks: number; enquiries: number; sales: number; revenue: number; reportedOnly: boolean }[];
}

/** Results for one campaign, or 'all'. Every total is a sum of the records it lists, so the table always adds up. */
export function totals(s: DemoState, scope: string): Totals {
  const inScope = <T extends { campaignId: string | null }>(r: T) => scope === 'all' || r.campaignId === scope;
  const act = s.activity.filter(inScope);
  const enq = s.enquiries.filter(inScope);
  const sales = s.sales.filter(inScope);
  const costs = s.costs.filter((k) => scope === 'all' || k.campaignId === scope);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const cost = (kind: string) => r2(sum(costs.filter((k) => k.kind === kind).map((k) => k.amount)));

  const rowMap = new Map<string, Totals['rows'][number]>();
  const row = (ch: ChannelId | null | undefined) => {
    const key = ch ?? 'none';
    if (!rowMap.has(key)) rowMap.set(key, { key, label: ch ? channelById(ch).name : 'No known source', reach: 0, visits: 0, clicks: 0, enquiries: 0, sales: 0, revenue: 0, reportedOnly: true });
    return rowMap.get(key)!;
  };
  for (const r of act) { const x = row(r.channel); x.reach += r.reach; x.visits += r.visits; x.clicks += r.clicks; x.reportedOnly = false; }
  for (const e of enq) { const x = row(e.source.kind === 'unknown' ? null : e.source.channel); x.enquiries += 1; if (e.source.kind === 'tracked') x.reportedOnly = false; }
  for (const sale of sales) { const x = row(sale.source.kind === 'unknown' ? null : sale.source.channel); x.sales += 1; x.revenue += sale.amount; if (sale.source.kind === 'tracked') x.reportedOnly = false; }
  const rows = [...rowMap.values()].sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : b.reach - a.reach));
  rows.forEach((r) => { if (r.key === 'none') r.reportedOnly = false; });

  const bySource = { tracked: { sales: 0, revenue: 0, enquiries: 0 }, reported: { sales: 0, revenue: 0, enquiries: 0 }, unknown: { sales: 0, revenue: 0, enquiries: 0 } };
  for (const sale of sales) { bySource[sale.source.kind].sales += 1; bySource[sale.source.kind].revenue += sale.amount; }
  for (const e of enq) bySource[e.source.kind].enquiries += 1;

  const salesCount = new Map<string, number>();
  for (const sale of s.sales) if (sale.customerId !== 'cu-walkin') salesCount.set(sale.customerId, (salesCount.get(sale.customerId) ?? 0) + 1);
  const repeatCustomers = new Set(sales.filter((x) => (salesCount.get(x.customerId) ?? 0) > 1).map((x) => x.customerId)).size;

  const ads = cost('ads'), messaging = cost('messaging'), content = cost('content');
  return {
    reach: sum(act.map((r) => r.reach)),
    visits: sum(act.map((r) => r.visits)),
    clicks: sum(act.map((r) => r.clicks)),
    enquiries: enq.length,
    sales: sales.length,
    revenue: r2(sum(sales.map((x) => x.amount))),
    costs: { ads, messaging, content, total: r2(ads + messaging + content) },
    repeatCustomers,
    bySource,
    rows,
  };
}

/** Recorded sales during a campaign's dates that are not linked to any campaign (unknown source, referral): never credited to it, but shown beside it. */
export function uncreditedSales(s: DemoState, scope: string): { count: number; revenue: number } {
  if (scope === 'all') return { count: 0, revenue: 0 };
  const c = s.campaigns.find((x) => x.id === scope);
  if (!c) return { count: 0, revenue: 0 };
  const xs = s.sales.filter((x) => x.campaignId === null && x.date >= c.startDate && x.date <= c.endDate);
  return { count: xs.length, revenue: r2(xs.reduce((n, x) => n + x.amount, 0)) };
}

/** Sales in plain terms: everything the shop sold in the period, what is linked to this campaign, and what has no known source. */
export function salesBreakdown(s: DemoState, scope: string) {
  const c = s.campaigns.find((x) => x.id === scope);
  const end = c ? [c.endDate, s.today].sort()[0] : s.today;
  const inPeriod = s.sales.filter((x) => !c || (x.date >= c.startDate && x.date <= end));
  const linkedList = c ? s.sales.filter((x) => x.campaignId === c.id) : s.sales.filter((x) => x.campaignId !== null);
  const all = [...new Map([...inPeriod, ...linkedList].map((x) => [x.id, x])).values()];
  const sum = (xs: Sale[]) => ({ count: xs.length, revenue: r2(xs.reduce((n, x) => n + x.amount, 0)) });
  const linkedIds = new Set(linkedList.map((x) => x.id));
  const unknown = all.filter((x) => x.source.kind === 'unknown');
  const elsewhere = all.filter((x) => !linkedIds.has(x.id) && x.source.kind !== 'unknown');
  return { all: sum(all), linked: sum(linkedList), unknown: sum(unknown), elsewhere: sum(elsewhere) };
}

/** How many of a plan's items have a scripted customer conversation in this demo. */
export function scriptedConversations(plan: Plan): number {
  return planSteps(plan).reduce((n, st) => n + st.formats.filter((f) => ARRIVALS[`${st.stage}:${f}`]).length, 0);
}

export interface Recommendation {
  id: string;
  title: string;
  why: string;
  input: GoalInput;
}

export interface Review {
  working: string[];
  dropOff: string[];
  uncertain: string[];
  next: Recommendation[];
}

/** The plain-English review. Simulated: fixed rules over the sample numbers, not real AI. */
export function review(s: DemoState, t: Totals, scope: string): Review {
  const working: string[] = [];
  const dropOff: string[] = [];
  const uncertain: string[] = [];
  const channelRows = t.rows.filter((r) => r.key !== 'none' && !r.reportedOnly);
  const best = [...channelRows].sort((a, b) => b.enquiries - a.enquiries || b.clicks - a.clicks)[0];
  const tied = best ? channelRows.filter((r) => r.enquiries === best.enquiries) : [];
  if (best && best.enquiries > 0 && tied.length > 1) working.push(`${tied.map((r) => r.label).join(' and ')} started the most recorded conversations, ${best.enquiries} each of ${t.enquiries}.`);
  else if (best && best.enquiries > 0) working.push(`${best.label} started the most recorded conversations: ${best.enquiries} of ${t.enquiries}.`);
  else if (best) working.push(`${best.label} reached the most people (${best.reach.toLocaleString('en-US')}), but has not started a conversation yet.`);
  const wa = t.rows.find((r) => r.key === 'whatsapp_status');
  if (wa && wa.reach > 0 && wa.clicks / wa.reach > 0.02) working.push('WhatsApp Status reaches few people, but a high share of them tap through. Your saved contacts are warm.');
  if (t.sales > 0) working.push(`${t.sales} sale${t.sales === 1 ? '' : 's'} recorded, worth $${t.revenue.toLocaleString('en-US')} in total.`);

  if (t.visits > 0) dropOff.push(`${t.visits.toLocaleString('en-US')} shop visits led to ${t.clicks} taps on "Ask on WhatsApp". Most visitors look and leave without asking.`);
  if (t.clicks > t.enquiries) dropOff.push(`${t.clicks} taps on "Ask on WhatsApp" were tracked, and ${t.enquiries} conversation${t.enquiries === 1 ? ' is' : 's are'} recorded. Some people tap and then do not send a message, but some conversations may simply not have been recorded here. Check whether enquiries were recorded before changing the campaign.`);
  const open = s.enquiries.filter((e) => (scope === 'all' || e.campaignId === scope) && (e.stage === 'new' || e.stage === 'waiting')).length;
  if (open) dropOff.push(`${open} conversation${open === 1 ? ' is' : 's are'} still waiting for your reply.`);
  const lost = s.enquiries.filter((e) => (scope === 'all' || e.campaignId === scope) && e.stage === 'lost');
  if (lost.length) dropOff.push(`${lost.length} enquir${lost.length === 1 ? 'y was' : 'ies were'} lost (${lost.map((e) => e.lostReason?.replace(/\.$/, '').toLowerCase()).join('; ')}).`);

  if (t.bySource.unknown.sales) uncertain.push(`${t.bySource.unknown.sales} sale${t.bySource.unknown.sales === 1 ? ' has' : 's have'} no known source, so we can not say what caused ${t.bySource.unknown.sales === 1 ? 'it' : 'them'}.`);
  if (t.bySource.reported.sales) uncertain.push(`${t.bySource.reported.sales} sale${t.bySource.reported.sales === 1 ? ' is' : 's are'} based on what the customer told you, not a tracked link.`);
  uncertain.push('Numbers this small can swing a lot from week to week. Treat them as a hint, not proof.');
  if (s.placements.some((p) => p.sharedByOwner)) uncertain.push('Reach for items you shared yourself is an estimate.');

  const budget = Math.round(s.business.monthlyBudget / 2);
  const next: Recommendation[] = [];
  if (t.clicks > t.enquiries * 2) next.push({ id: 'r-convert', title: 'Make the WhatsApp step easier', why: 'More people tap "Ask on WhatsApp" than conversations are recorded. Once you have checked that every conversation was recorded, a friendly ready-made first message and quick replies could turn more taps into conversations.', input: { goal: 'convert', weeks: 2, budget, fromRecommendation: 'Make the WhatsApp step easier' } });
  const optedIn = recipientsFor(s.customers);
  next.push({ id: 'r-repeat', title: 'Give past customers a first look', why: `${optedIn} people agreed to hear from you on WhatsApp${t.repeatCustomers ? `, and ${t.repeatCustomers} customer${t.repeatCustomers === 1 ? ' has' : 's have'} already bought twice` : ''}. They are the cheapest people to reach.`, input: { goal: 'repeat', weeks: 2, budget: Math.round(budget / 3), fromRecommendation: 'Give past customers a first look' } });
  const videoIds = new Set(s.placements.filter((p) => p.format === 'ig_reel' || p.format === 'tiktok_video').map((p) => p.id));
  const videoReach = s.activity.filter((r) => (scope === 'all' || r.campaignId === scope) && r.placementId && videoIds.has(r.placementId)).reduce((n, r) => n + r.reach, 0);
  const videoWhy = videoReach
    ? `Your styling video reached about ${videoReach.toLocaleString('en-US')} people, an estimate because you shared it yourself. A two-week test on TikTok and reels would show whether video also brings conversations.`
    : 'Short styling videos have not been tried yet. A two-week test on TikTok and reels would show whether video brings conversations for your shop.';
  next.push({ id: 'r-reach', title: 'Test short styling videos', why: videoWhy, input: { goal: 'reach', weeks: 2, budget, fromRecommendation: 'Test short styling videos' } });
  return { working, dropOff, uncertain, next: next.slice(0, 3) };
}

/** The money in plain words. Product costs are not known to the prototype, so it never claims a profit. */
export function economics(s: DemoState, t: Totals, scope: string): string {
  const gap = r2(Math.abs(t.revenue - t.costs.total));
  const c = s.campaigns.find((x) => x.id === scope);
  const running = c ? c.status === 'active' : liveCampaigns(s).length > 0;
  const tail = running ? ' The campaign is still running, and some sales may not have been recorded.' : ' Some sales may not have been recorded.';
  if (!t.costs.total && !t.revenue) return 'No marketing costs or sales are recorded yet.';
  if (t.revenue < t.costs.total) return `Recorded revenue is currently $${gap.toLocaleString('en-US')} below marketing costs, before product costs.${tail}`;
  if (t.revenue === t.costs.total) return `Recorded revenue currently equals marketing costs, before product costs.${tail}`;
  return `Recorded revenue is currently $${gap.toLocaleString('en-US')} above marketing costs. That is before product costs, so it is not profit.${tail}`;
}

export interface NextStep {
  title: string;
  detail: string;
  href: string;
  cta: string;
  /** A second action shown beside the first, when two things need the owner. */
  also?: { href: string; cta: string };
}

export function waitingCustomers(s: DemoState) {
  return s.enquiries.filter((e) => e.stage === 'new' || e.stage === 'waiting');
}

export function dueFollowUps(s: DemoState) {
  return s.enquiries.filter((e) => e.followUp && e.followUp.date <= s.today);
}

export function campaignProgress(s: DemoState, c: Campaign) {
  const mats = s.materials.filter((m) => m.campaignId === c.id);
  const pls = s.placements.filter((p) => p.campaignId === c.id);
  const shown = pls.map((p) => shownState(s, p));
  const count = (st: ShownState) => shown.filter((x) => x === st).length;
  const day = Math.min(c.plan.days, Math.max(0, daysBetween(c.startDate, s.today) + 1));
  const upcoming = pls.filter((p, i) => shown[i] === 'scheduled').sort((a, b) => a.date.localeCompare(b.date))[0];
  return {
    mats, pls, day, upcoming,
    awaiting: mats.filter((m) => m.status !== 'approved').length,
    changes: mats.filter((m) => m.status === 'changes').length,
    published: count('published'), failed: count('failed'), manual: count('manual'), scheduled: count('scheduled'), paused: count('paused'),
    finished: s.today > c.endDate || (pls.length > 0 && pls.every((p) => p.state === 'published')),
  };
}

export function nextStep(s: DemoState): NextStep {
  if (s.onboarding === 'pending') return { title: 'Tell us about your business', detail: 'A few short questions so your marketing manager understands your shop.', href: '#/welcome', cta: 'Start' };
  const waiting = waitingCustomers(s).length;
  const people = `${waiting === 1 ? 'One customer needs' : `${waiting === 2 ? 'Two' : waiting} customers need`} your reply`;
  const replies = { href: '#/customers', cta: 'Review replies' };
  const d = s.draft?.plan;
  if (d) {
    const rec = !!s.draft?.recommended;
    const planBtn = { href: '#/plan', cta: rec ? 'Review recommended plan' : 'Review plan' };
    if (waiting) return { title: `${people}. I've also prepared your next campaign for review.`, detail: `A suggested reply is ready for each conversation. The plan "${d.name}" is waiting for you to check, change or accept.`, ...replies, also: planBtn };
    return { title: rec ? "I've prepared your next campaign for review" : 'Review your proposed plan', detail: `"${d.name}" is ready. Check it, change anything, then accept it. You can also choose a different goal.`, ...planBtn };
  }
  const also = waiting ? replies : undefined;
  for (const c of liveCampaigns(s)) {
    const p = campaignProgress(s, c);
    if (p.awaiting) return { title: `Approve ${p.awaiting} campaign item${p.awaiting === 1 ? '' : 's'}`, detail: p.changes ? `${p.changes} item${p.changes === 1 ? ' was' : 's were'} sent back for changes.` : `For "${c.name}". Nothing goes out until you approve it, exactly as shown for each channel.`, href: '#/approvals', cta: 'Review items', also };
    if (adNeedsApproval(s, c)) return { title: 'Decide on paid ads', detail: `The ad for "${c.name}" is approved, but it will not run or spend until you approve its audience, dates and spending limit.`, href: '#/approvals', cta: 'Review ad settings', also };
    if (!c.scheduled) return { title: 'Schedule your approved campaign', detail: `Everything in "${c.name}" is approved. Schedule it so each item goes out on its planned day.`, href: '#/campaigns', cta: 'Go to campaign', also };
    const blocked = p.pls.filter((x) => x.state === 'scheduled' && FORMATS[x.format].auto && s.connections[FORMATS[x.format].channel] !== 'connected');
    if (blocked.length && !p.failed) {
      const names = [...new Set(blocked.map((x) => channelById(FORMATS[x.format].channel).name))].join(' and ');
      return { title: `Reconnect ${names} before your next post`, detail: `${blocked.length} upcoming item${blocked.length === 1 ? '' : 's'} can only be posted for you once ${names} is connected again (demo). Otherwise ${blocked.length === 1 ? 'it' : 'they'} will fail on the day.`, href: '#/channels', cta: 'Check connections', also };
    }
    if (p.failed) return { title: 'Fix a failed item', detail: 'Something could not go out. It usually takes one step to fix.', href: '#/campaigns', cta: 'See what failed', also };
    if (p.manual) return { title: `Share ${p.manual} item${p.manual === 1 ? '' : 's'} yourself`, detail: 'Some formats need you to post from your phone. The words and picture are ready to copy.', href: '#/campaigns', cta: 'Open share pack', also };
  }
  if (waiting) return { title: people, detail: 'People are waiting on WhatsApp. A suggested reply is ready for each.', ...replies };
  const due = dueFollowUps(s).length;
  if (due) return { title: `${due} follow-up${due === 1 ? ' is' : 's are'} due`, detail: 'A quick message keeps the conversation going.', href: '#/customers/followup', cta: 'See follow-ups' };
  const c = activeCampaign(s);
  if (!c) return { title: 'Nothing is planned yet', detail: 'Your marketing manager can prepare a recommended plan, or you can choose a goal yourself.', href: '#/plan', cta: 'Get a recommended plan' };
  const p = campaignProgress(s, c);
  if (c.paused) return { title: 'Your campaign is paused', detail: 'Nothing goes out and ads are not spending. Resume when you are ready.', href: '#/campaigns', cta: 'Go to campaign' };
  if (!p.finished) return { title: 'Your campaign is running', detail: p.upcoming ? `Next item goes out ${p.upcoming.date === s.today ? 'today' : 'on its planned day'}. Move the demo forward to see it happen.` : 'Everything is out. Results keep coming in.', href: '#/campaigns', cta: 'See campaign' };
  return { title: 'See what worked and plan what is next', detail: 'Your campaign has finished. Read the review and turn a recommendation into your next plan.', href: '#/results', cta: 'See results' };
}

/** The ad's content is approved but paid activity has not been approved yet. */
export function adNeedsApproval(s: DemoState, c: Campaign): boolean {
  if (c.adApproved || c.plan.adDaily <= 0) return false;
  const ad = s.materials.find((m) => m.campaignId === c.id && m.formats[0] === 'ad');
  return !!ad && ad.status === 'approved';
}

/** The short manager update on the home screen. Simulated: written from the sample records by fixed rules. */
export function managerUpdate(s: DemoState): string[] {
  const c = activeCampaign(s);
  const lines: string[] = [];
  const waiting = waitingCustomers(s).length;
  if (c) {
    const p = campaignProgress(s, c);
    const t = totals(s, c.id);
    if (!c.scheduled) lines.push(`I prepared ${p.mats.length} items for "${c.name}". ${p.awaiting ? `${p.awaiting} still need your approval before anything can go out.` : 'All are approved and ready to schedule.'}`);
    else if (c.paused) lines.push(`"${c.name}" is paused on day ${p.day} of ${c.plan.days}. Nothing is going out and the ads are not spending.`);
    else if (s.today < c.startDate) lines.push(`"${c.name}" is scheduled. The first item goes out on its start day. ${p.awaiting ? `${p.awaiting} item${p.awaiting === 1 ? '' : 's'} still need${p.awaiting === 1 ? 's' : ''} your approval.` : ''}`.trim());
    else lines.push(`"${c.name}" is on day ${p.day} of ${c.plan.days}. ${p.published} item${p.published === 1 ? ' has' : 's have'} gone out in the demo, reaching about ${t.reach.toLocaleString('en-US')} people.`);
    if (adNeedsApproval(s, c)) lines.push(`The ad is approved, but it will not run or spend until you approve its audience, dates and spending limit of $${r2(c.plan.adDaily * c.plan.days)}.`);
    if (p.failed) lines.push(`${p.failed} item${p.failed === 1 ? '' : 's'} could not go out because a channel connection expired. One reconnection should fix it.`);
    if (p.manual) lines.push(`${p.manual} item${p.manual === 1 ? ' is' : 's are'} ready for you to share from your phone.`);
    if (t.enquiries) lines.push(`So far it has started ${t.enquiries} WhatsApp conversation${t.enquiries === 1 ? '' : 's'}${t.sales ? ` and ${t.sales} recorded sale${t.sales === 1 ? '' : 's'}` : ''}.`);
  } else {
    const last = [...s.campaigns].filter((x) => x.status === 'ended').sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    if (last) {
      const t = totals(s, last.id);
      const ago = daysBetween(last.endDate, s.today);
      if (last.cancelled) lines.push(`Your last campaign, "${last.name}", was cancelled before it started.`);
      else lines.push(`Your last campaign, "${last.name}", ended ${ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`}. It reached about ${t.reach.toLocaleString('en-US')} people, started ${t.enquiries} WhatsApp conversations and led to ${t.sales} recorded sale${t.sales === 1 ? '' : 's'}.`);
    }
    lines.push(s.draft?.plan
      ? (s.draft.recommended ? `Nothing is running right now, so I prepared "${s.draft.plan.name}" for you to review.` : 'Your new plan is ready for you to review.')
      : 'Nothing is running right now. I can prepare a recommended plan, or you can choose a goal yourself.');
  }
  if (waiting) lines.push(`${waiting} customer${waiting === 1 ? ' is' : 's are'} waiting for a reply on WhatsApp.`);
  return lines;
}

export const goalLabel = (g: GoalId) => GOALS[g].label;
export const productName = (id: string) => productById(id).name;
export const planCostsFor = (s: DemoState, plan: Plan) => planCosts(plan, recipientsFor(s.customers));
