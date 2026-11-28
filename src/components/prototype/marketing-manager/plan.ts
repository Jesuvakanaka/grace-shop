// AI Marketing Manager prototype: the simulated planner and copywriter.
// No AI is called. Plans and captions come from fixed templates filled with the
// owner's answers and the sample catalogue, so the same choices give the same plan.
import {
  AD_DAILY_RESULTS_PER_DOLLAR, COLLECTIONS, FORMAT_SAMPLE_RESULTS, FORMATS, SAMPLE_OPTED_IN_LIST, WHATSAPP_RATE,
  productById, type ChannelId, type FormatId,
} from './catalog';
import { addDays, r2 } from './dates';
import type { Business, Customer, GoalId, GoalInput, Material, Plan, PlanChannel, Stage } from './types';

export const GOALS: Record<GoalId, { label: string; hint: string }> = {
  reach: { label: 'Bring more suitable shoppers', hint: 'Get your pieces in front of new people who are likely to buy.' },
  convert: { label: 'Turn more enquiries into orders', hint: 'Help people who already message you decide and buy.' },
  collection: { label: 'Promote a new collection', hint: 'Launch a group of pieces with one clear story.' },
  repeat: { label: 'Encourage previous customers to buy again', hint: 'Bring back people who have bought before.' },
};

export const GOAL_ORDER: GoalId[] = ['reach', 'convert', 'collection', 'repeat'];

export const STAGES: Stage[] = ['discovery', 'demo', 'trust', 'invite', 'followup'];

/** Journey step names. The styling demonstration belongs to discovery. */
export const STAGE_INFO: Record<Stage, { label: string; journey: 'Discovery' | 'Trust' | 'Purchase' | 'Follow-up'; pos: number; what: string }> = {
  discovery: { label: 'Discovery post', journey: 'Discovery', pos: 0, what: 'Gets the collection seen by new people.' },
  demo: { label: 'Styling demonstration', journey: 'Discovery', pos: 0.25, what: 'Shows a piece styled for real occasions.' },
  trust: { label: 'Trust builder', journey: 'Trust', pos: 0.45, what: 'Answers the doubts people have before they buy.' },
  invite: { label: 'Invitation to enquire', journey: 'Purchase', pos: 0.65, what: 'Asks people to message you on WhatsApp to order.' },
  followup: { label: 'Follow-up message', journey: 'Follow-up', pos: 0.9, what: 'Thanks people who enquired or bought, with a styling tip.' },
};

export const stageDay = (stage: Stage, days: number) => Math.round(STAGE_INFO[stage].pos * (days - 1));

const STAGE_CANDIDATES: Record<Stage, FormatId[]> = {
  discovery: ['ig_post', 'fb_post', 'ad', 'fb_group'],
  demo: ['ig_reel', 'tiktok_video'],
  trust: ['fb_post', 'ig_post', 'wa_channel'],
  invite: ['ig_story', 'wa_status'],
  followup: ['wa_message'],
};

/** The formats a stage uses, given the plan's channels. Never empty: Instagram and WhatsApp are always in a plan. */
export function stageFormats(stage: Stage, channels: ChannelId[]): FormatId[] {
  const picked = STAGE_CANDIDATES[stage].filter((f) => channels.includes(FORMATS[f].channel));
  if (stage === 'trust' && picked.includes('fb_post') && picked.includes('ig_post')) return picked.filter((f) => f !== 'ig_post');
  return picked.length ? picked : [STAGE_CANDIDATES[stage][0]];
}

// -------------------------------------------------------------- plan building

const LOCK_IG = 'Your main place to be discovered. Always in the plan.';
const LOCK_WA = 'Needed to follow up with people who enquire. Always in the plan.';

function why(id: ChannelId, goal: GoalId, areas: string): string {
  switch (id) {
    case 'instagram': return goal === 'convert' ? 'Stories remind people who already follow you, just before they decide.' : 'Where most fashion shoppers discover new shops. Good for photos, reels and stories.';
    case 'facebook': return 'Reaches people who use Facebook more than Instagram, often an older audience.';
    case 'meta_ads': return goal === 'convert'
      ? 'Shows a reminder only to people who visited your shop recently. Marketers call this "retargeting".'
      : `A small daily amount shows the posts to more of the right people, only in ${areas || 'your delivery area'}.`;
    case 'tiktok': return 'Short styling videos can reach many new people without paying for ads.';
    case 'facebook_groups': return 'Local buying and selling groups bring nearby shoppers at no cost.';
    case 'whatsapp_status': return 'Your saved contacts already trust you. They see it when they check Status.';
    case 'whatsapp_channel': return 'Keeps followers updated without messaging them one by one.';
    case 'whatsapp_business': return goal === 'repeat' ? 'Reaches past customers who agreed to hear from you, in the app they already use.' : 'Follows up with people who enquired and agreed to hear from you.';
    default: return '';
  }
}

interface Template {
  name: string;
  collection: keyof typeof COLLECTIONS;
  audienceTail: string;
  message: string;
  reason: (b: Business) => string;
  variants: ChannelId[][];
}

const TEMPLATES: Record<GoalId, Template> = {
  collection: {
    name: 'Dress confidently for your next occasion',
    collection: 'occasion',
    audienceTail: 'Especially those with a wedding, graduation or church event in the next month.',
    message: 'Dress confidently for your next occasion.',
    reason: (b) => `Statement pieces in rich colours that photograph beautifully and stay comfortable all day. ${b.worthChoosing}`.trim(),
    variants: [
      ['instagram', 'facebook', 'meta_ads', 'whatsapp_status', 'whatsapp_business'],
      ['instagram', 'tiktok', 'facebook_groups', 'whatsapp_status', 'whatsapp_business'],
    ],
  },
  reach: {
    name: 'Meet the shoppers who suit VYRA',
    collection: 'bestsellers',
    audienceTail: 'Who have not heard of the shop yet.',
    message: 'Bold colour, easy elegance. Wear different.',
    reason: (b) => `Pieces you will not see on everyone else, with friendly help on WhatsApp. ${b.worthChoosing}`.trim(),
    variants: [
      ['instagram', 'facebook', 'meta_ads', 'whatsapp_status', 'whatsapp_business'],
      ['instagram', 'tiktok', 'facebook_groups', 'whatsapp_business'],
    ],
  },
  convert: {
    name: 'Help interested shoppers decide',
    collection: 'occasion',
    audienceTail: 'Who have already visited the shop or asked a question, but not ordered yet.',
    message: 'Still thinking about it? Ask us anything.',
    reason: () => 'A real person answers on WhatsApp with honest fit advice, so you can order with confidence.',
    variants: [
      ['instagram', 'meta_ads', 'whatsapp_status', 'whatsapp_business'],
      ['instagram', 'whatsapp_status', 'whatsapp_channel', 'whatsapp_business'],
    ],
  },
  repeat: {
    name: 'First look for past customers',
    collection: 'occasion',
    audienceTail: 'Who have bought before and agreed to hear from the shop.',
    message: 'You get the first look at our new pieces.',
    reason: () => 'Past customers already know the quality and fit. A personal first look makes them feel valued.',
    variants: [
      ['instagram', 'whatsapp_status', 'whatsapp_business'],
      ['instagram', 'whatsapp_channel', 'whatsapp_status', 'whatsapp_business'],
    ],
  },
};

export const VIDEO_EDIT = { label: 'Short styling video edit (sample freelance rate)', cost: 15 };
export const WRITING = { label: 'Captions and layouts prepared by your marketing manager', cost: 0 };

/** People a WhatsApp follow-up would go to: the sample opted-in list plus sample customers who said yes. */
export const recipientsFor = (customers: Customer[]) => SAMPLE_OPTED_IN_LIST + customers.filter((c) => c.marketingOk).length;

export function planChannelsFor(goal: GoalId, ids: ChannelId[], areas: string): PlanChannel[] {
  return ids.map((id) => ({
    id,
    why: why(id, goal, areas),
    locked: id === 'instagram' ? LOCK_IG : id === 'whatsapp_business' ? LOCK_WA : undefined,
  }));
}

export function contentFor(channels: ChannelId[]): { label: string; cost: number }[] {
  const formats = stageFormats('demo', channels);
  return formats.some((f) => f === 'ig_reel' || f === 'tiktok_video') ? [WRITING, VIDEO_EDIT] : [WRITING];
}

export interface PlanCosts {
  ads: number;
  messaging: number;
  content: number;
  total: number;
  adDays: number;
  recipients: number;
}

export function planCosts(plan: Plan, recipients: number): PlanCosts {
  const ids = plan.channels.map((c) => c.id);
  const adDays = ids.includes('meta_ads') ? plan.days : 0;
  const ads = r2(plan.adDaily * adDays);
  const messaging = ids.includes('whatsapp_business') ? r2(recipients * WHATSAPP_RATE) : 0;
  const content = r2(plan.content.reduce((s, c) => s + c.cost, 0));
  return { ads, messaging, content, total: r2(ads + messaging + content), adDays, recipients };
}

/** The biggest whole-dollar daily ad amount that keeps the plan within budget (max $15 a day). */
export function fitAdDaily(plan: Omit<Plan, 'adDaily'>, recipients: number): number {
  if (!plan.channels.some((c) => c.id === 'meta_ads')) return 0;
  const rest = planCosts({ ...plan, adDaily: 0 } as Plan, recipients).total;
  return Math.max(0, Math.min(15, Math.floor((plan.budget - rest) / plan.days)));
}

export function buildPlan(input: GoalInput, business: Business, today: string, variant: number, recipients: number): Plan {
  const t = TEMPLATES[input.goal];
  const v = ((variant % t.variants.length) + t.variants.length) % t.variants.length;
  const ids = t.variants[v];
  const col = COLLECTIONS[t.collection];
  const channels = planChannelsFor(input.goal, ids, business.areas);
  const base = {
    goal: input.goal,
    variant: v,
    name: input.goal === 'reach' ? `Meet the shoppers who suit ${business.name || 'your shop'}` : t.name,
    collectionName: col.name,
    productIds: [...col.productIds],
    audience: `${business.audience.replace(/\.\s*$/, '')}. ${t.audienceTail}`,
    message: t.message,
    reason: t.reason(business),
    channels,
    startDate: addDays(today, 1),
    days: input.weeks * 7,
    budget: input.budget,
    content: contentFor(ids),
    fromRecommendation: input.fromRecommendation,
  };
  let plan: Plan = { ...base, adDaily: 0 };
  plan = { ...plan, adDaily: fitAdDaily(plan, recipients) };
  // Too little budget for ads: drop them rather than pretend.
  if (ids.includes('meta_ads') && plan.adDaily < 1) {
    plan = { ...plan, channels: plan.channels.filter((c) => c.id !== 'meta_ads'), adDaily: 0 };
  }
  return plan;
}

/** Change channels or the period while editing, keeping the costs consistent. */
export function reshapePlan(plan: Plan, patch: Partial<Plan>, recipients: number, areas: string): Plan {
  const next: Plan = { ...plan, ...patch, edited: true };
  if (patch.channels) {
    const ids = next.channels.map((c) => c.id);
    next.channels = planChannelsFor(plan.goal, ids, areas);
    next.content = contentFor(ids);
    if (!ids.includes('meta_ads')) next.adDaily = 0;
    else if (!plan.channels.some((c) => c.id === 'meta_ads')) next.adDaily = Math.max(1, fitAdDaily(next, recipients));
  }
  if (patch.days && next.adDaily > 0) {
    // Keep within budget when the period gets longer.
    next.adDaily = Math.min(next.adDaily, Math.max(1, fitAdDaily(next, recipients)));
  }
  return next;
}

/** Optional channels the owner may add while editing a plan. */
export const OPTIONAL_CHANNELS: ChannelId[] = ['facebook', 'meta_ads', 'tiktok', 'facebook_groups', 'whatsapp_status', 'whatsapp_channel'];

export interface PlanStep {
  stage: Stage;
  date: string;
  formats: FormatId[];
  productId: string;
}

export function planSteps(plan: Plan): PlanStep[] {
  const ids = plan.channels.map((c) => c.id);
  return STAGES.map((stage, i) => ({
    stage,
    date: addDays(plan.startDate, stageDay(stage, plan.days)),
    formats: stageFormats(stage, ids),
    productId: plan.productIds[[0, 1, 2, 0, 0][i] % plan.productIds.length],
  }));
}

export interface Estimate { reach: number; visits: number; clicks: number }

/** What the same sample numbers the demo uses would add up to. Shown as a rough range, never a promise. */
export function planEstimate(plan: Plan, recipients: number): Estimate {
  const e: Estimate = { reach: 0, visits: 0, clicks: 0 };
  for (const step of planSteps(plan)) {
    for (const f of step.formats) {
      const s = FORMAT_SAMPLE_RESULTS[f];
      e.reach += f === 'wa_message' ? recipients : s.reach;
      e.visits += s.visits;
      e.clicks += s.clicks;
    }
  }
  if (plan.channels.some((c) => c.id === 'meta_ads')) {
    e.reach += Math.round(plan.adDaily * AD_DAILY_RESULTS_PER_DOLLAR.reach) * plan.days;
    e.visits += Math.round(plan.adDaily * AD_DAILY_RESULTS_PER_DOLLAR.visits) * plan.days;
    e.clicks += Math.round(plan.adDaily * AD_DAILY_RESULTS_PER_DOLLAR.clicks) * plan.days;
  }
  return e;
}

export const roundRange = (n: number, lo = 0.7, hi = 1.3) => {
  const step = n > 2000 ? 500 : n > 200 ? 50 : n > 40 ? 10 : 1;
  const a = Math.max(0, Math.floor((n * lo) / step) * step);
  const b = Math.ceil((n * hi) / step) * step;
  return [a, b] as const;
};

// -------------------------------------------------------------- copywriting

const firstPara = (caption: string) => caption.split('\n\n')[0];
const restParas = (caption: string) => caption.split('\n\n').slice(1).join('\n\n');

export function withOpening(caption: string, opening: string): string {
  const rest = restParas(caption);
  return rest ? `${opening}\n\n${rest}` : opening;
}

export const openingOf = firstPara;

function policyLines(b: Business): string {
  const lines: string[] = [];
  if (b.ordering) lines.push(`How to order: ${b.ordering}`);
  if (b.delivery) lines.push(`Delivery: ${b.delivery}`);
  if (b.returns) lines.push(`Returns: ${b.returns}`);
  return lines.join('\n');
}

const tag = (s: string) => `#${s.replace(/[^A-Za-z0-9]/g, '')}`;

interface Copy { title: string; purpose: string; openings: string[]; body: string }

function copyFor(stage: Stage, plan: Plan, b: Business, productId: string): Copy {
  const p = productById(productId);
  const pn = p.name.toLowerCase();
  const shop = b.name || 'our shop';
  const policies = policyLines(b);
  switch (stage) {
    case 'discovery':
      return {
        title: `${plan.collectionName}: first look`,
        purpose: 'Gets the collection seen by new people.',
        openings: [plan.message, 'Got an occasion coming up?', 'The dress that walks in before you do.'],
        body: `Meet the ${pn}. ${p.note} Made for the moments you want to remember.\n\nSee every piece in ${plan.collectionName.replace(/^The /, 'the ')} through the link, or send us a message on WhatsApp.\n\n${tag(shop)} #WearDifferent #OccasionWear`,
      };
    case 'demo':
      return {
        title: `Three ways to style the ${pn}`,
        purpose: 'Shows one piece styled for real occasions.',
        openings: ['One piece, three occasions.', 'Wedding, church or dinner? Same dress.', 'How would you wear it?'],
        body: `With heels for a wedding, flats for a long church service, and a light jacket for an evening dinner. Watch the short video and tell us which look is yours.\n\nAsk us for fit advice on WhatsApp before you choose your size.`,
      };
    case 'trust':
      return {
        title: 'How we help you choose the right fit',
        purpose: 'Answers the doubts people have before buying online.',
        openings: ['Not sure about your size?', 'Buying online should not be a guess.', 'Ask before you buy. We like that.'],
        body: `Send us your usual size and height on WhatsApp and we will tell you honestly how the ${pn} fits. ${b.worthChoosing}\n\nNo pressure to buy. Just ask.${policies ? `\n\n${policies}` : ''}`,
      };
    case 'invite':
      return {
        title: 'Ask us on WhatsApp',
        purpose: 'Asks people who are interested to message you to order.',
        openings: ['Ready when you are.', 'Your occasion, sorted.', 'Which colour is calling you?'],
        body: `${plan.collectionName.replace(/^the /, 'The ')} is ready for your next occasion. Tap "Ask on WhatsApp" to check your size and colour.${policies ? `\n\n${policies}` : ''}`,
      };
    case 'followup':
      return {
        title: 'Thank-you and styling tip',
        purpose: 'Thanks people who enquired or bought, with a useful tip.',
        openings: ['Hi {first name}, thank you for visiting ' + shop + '.', 'Hi {first name}, a quick styling tip for you.', 'Hi {first name}, we saved this idea for you.'],
        body: `A slim belt and simple gold jewellery make any piece from ${plan.collectionName} feel ready for a special day. Reply here any time if you have a question.\n\nReply STOP to stop these messages.`,
      };
  }
}

export function buildMaterials(plan: Plan, b: Business, campaignId: string, startSeq: number): Material[] {
  return planSteps(plan).map((step, i) => {
    const c = copyFor(step.stage, plan, b, step.productId);
    const images = step.stage === 'demo'
      ? plan.productIds.slice(0, 3).map((id) => productById(id).image)
      : [productById(step.productId).image];
    return {
      id: `m${startSeq + i}`,
      campaignId,
      stage: step.stage,
      title: c.title,
      purpose: c.purpose,
      productId: step.productId,
      images,
      formats: step.formats,
      versions: [{ n: 1, caption: `${c.openings[0]}\n\n${c.body}`, by: 'manager', why: 'Prepared by your marketing manager (simulated)' }],
      openings: c.openings,
      status: 'awaiting',
      approvedVersion: null,
      reapproval: false,
      date: step.date,
    };
  });
}

export type RevisionStyle = 'shorter' | 'warmer' | 'direct';

export const REVISION_LABEL: Record<RevisionStyle, string> = {
  shorter: 'Shorter and simpler',
  warmer: 'Warmer and more personal',
  direct: 'A clearer ask to order',
};

export function revise(caption: string, style: RevisionStyle): string {
  const paras = caption.split('\n\n');
  switch (style) {
    case 'shorter': {
      const keep = [paras[0], paras[1]].filter(Boolean);
      const firstSentence = (keep[1] ?? '').split(/(?<=\.)\s/)[0];
      const stop = paras.find((x) => x.startsWith('Reply STOP'));
      return [keep[0], firstSentence, stop].filter(Boolean).join('\n\n');
    }
    case 'warmer':
      return [...paras.slice(0, 1), 'We would love to help you find a look you feel wonderful in.', ...paras.slice(1)].join('\n\n');
    case 'direct': {
      const ask = 'Message us on WhatsApp today and we will check your size for you.';
      return caption.includes(ask) ? caption : [...paras.filter((x) => !x.startsWith('Reply STOP')), ask, ...paras.filter((x) => x.startsWith('Reply STOP'))].join('\n\n');
    }
  }
}

export function styleFromNote(note: string): RevisionStyle {
  const n = note.toLowerCase();
  if (/(short|long|too much|simple|wordy)/.test(n)) return 'shorter';
  if (/(warm|friend|cold|personal|kind)/.test(n)) return 'warmer';
  return 'direct';
}
