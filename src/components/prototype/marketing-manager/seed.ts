// AI Marketing Manager prototype: the prepared demo. Every person, number and
// conversation here is fictional sample data, dated relative to the day the demo
// is first opened (or reset).
import { COLLECTIONS, INITIAL_CONNECTIONS } from './catalog';
import { addDays, isoToday } from './dates';
import { buildPlan } from './plan';
import type { Business, DemoState } from './types';

export const STORAGE_KEY = 'vyra-marketing-manager-prototype-v1';

export const EXAMPLE_BUSINESS: Business = {
  name: 'VYRA',
  sells: 'Women’s occasion and everyday dresses, sets and jumpsuits in bold colours.',
  audience: 'Women aged about 25 to 45 in Harare who like elegant, colourful clothes',
  areas: 'Harare',
  worthChoosing: 'Every piece is chosen by hand, and we give honest fit advice on WhatsApp before you buy.',
  delivery: null,
  returns: null,
  ordering: 'Message us on WhatsApp to order.',
  payment: null,
  language: 'English',
  voice: 'Warm, confident and simple. No slang.',
  monthlyBudget: 300,
};

export const PREV_ID = 'c-prev';

export function seedState(today: string = isoToday()): DemoState {
  const prevStart = addDays(today, -24);
  const prevEnd = addDays(today, -11);
  const prevPlan = {
    ...buildPlan({ goal: 'reach', weeks: 2, budget: 60 }, EXAMPLE_BUSINESS, addDays(prevStart, -1), 0, 39),
    name: COLLECTIONS.newIn.name,
    collectionName: COLLECTIONS.newIn.name,
    productIds: [...COLLECTIONS.newIn.productIds],
    adDaily: 3,
    content: [{ label: 'Captions and layouts prepared by your marketing manager', cost: 0 }],
  };

  return {
    version: 1,
    onboarding: 'pending',
    today,
    business: { ...EXAMPLE_BUSINESS },
    connections: { ...INITIAL_CONNECTIONS },
    draft: null,
    campaigns: [
      { id: PREV_ID, name: COLLECTIONS.newIn.name, goal: 'reach', plan: prevPlan, status: 'ended', startDate: prevStart, endDate: prevEnd, scheduled: true, paused: false },
    ],
    materials: [],
    placements: [],
    activity: [
      { id: 'a1', date: prevStart, campaignId: PREV_ID, channel: 'instagram', reach: 1840, visits: 96, clicks: 14 },
      { id: 'a2', date: addDays(prevStart, 1), campaignId: PREV_ID, channel: 'facebook', reach: 620, visits: 21, clicks: 4 },
      { id: 'a3', date: addDays(prevStart, 4), campaignId: PREV_ID, channel: 'whatsapp_status', reach: 210, visits: 18, clicks: 6 },
      { id: 'a4', date: prevEnd, campaignId: PREV_ID, channel: 'meta_ads', reach: 3100, visits: 140, clicks: 11 },
      { id: 'a5', date: addDays(today, -1), campaignId: null, channel: null, reach: 0, visits: 410, clicks: 22 },
    ],
    costs: [
      { id: 'k1', date: prevEnd, campaignId: PREV_ID, kind: 'ads', amount: 42, note: '14 days at $3 a day (sample)' },
    ],
    customers: [
      { id: 'cu-nyasha', name: 'Nyasha T.', marketingOk: true },
      { id: 'cu-chipo', name: 'Chipo M.', marketingOk: true },
      { id: 'cu-farai', name: 'Farai D.', marketingOk: false },
      { id: 'cu-tendai', name: 'Tendai S.', marketingOk: false },
      { id: 'cu-ruvimbo', name: 'Ruvimbo C.', marketingOk: false },
      { id: 'cu-rumbi', name: 'Rumbi K.', marketingOk: false },
      { id: 'cu-grace', name: 'Grace N.', marketingOk: false },
      { id: 'cu-memory', name: 'Memory P.', marketingOk: true },
      { id: 'cu-walkin', name: 'Buyer not recorded', marketingOk: false },
    ],
    enquiries: [
      {
        id: 'e-rumbi', customerId: 'cu-rumbi', productId: 'p-lime', campaignId: null,
        source: { kind: 'unknown', detail: 'Tapped "Ask on WhatsApp" on the shop website. No campaign link was used.' },
        stage: 'new', created: today,
        messages: [{ from: 'customer', date: today, text: 'Hi! Is the lime pleated dress available in size 14? And how much is delivery to Borrowdale?' }],
        question: 'Is size 14 available, and how much is delivery to Borrowdale?',
        suggestedReply: 'Hi Rumbi, thank you for asking! I am checking size 14 for you now. Delivery to Borrowdale costs [add your delivery price]. Would you like me to hold one for you while I confirm?',
        script: [{ customer: 'Yes please hold it. Can I pay when it arrives?', question: 'Can she pay on delivery?', suggestion: 'Thank you Rumbi! For payment, [add how customers can pay]. I will message you as soon as your size is confirmed.' }],
      },
      {
        id: 'e-tendai', customerId: 'cu-tendai', productId: 'p-bronze', campaignId: PREV_ID,
        source: { kind: 'tracked', channel: 'meta_ads', detail: 'Came through the tracked link on the Facebook and Instagram ad.' },
        stage: 'waiting', created: addDays(today, -2),
        messages: [
          { from: 'customer', date: addDays(today, -2), text: 'Hi, I saw the bronze set. What is the fabric like? Is it heavy?' },
          { from: 'shop', date: addDays(today, -2), text: 'Hi Tendai! It is a light pleated fabric with a soft shine. It moves nicely and is not heavy.' },
          { from: 'customer', date: addDays(today, -1), text: 'Ok thanks. Is it see-through at all? It’s for my sister’s graduation.' },
        ],
        question: 'Is the bronze set see-through?',
        suggestedReply: 'Not at all. The skirt is lined, so it is not see-through. It would look lovely at a graduation! Shall I check your size?',
        script: [{ customer: 'Great, I’m a size 12. Do you have it?', question: 'Is size 12 in stock?', suggestion: 'Yes, we have a size 12. Would you like to order it? I can send you the details.' }],
      },
      {
        id: 'e-memory', customerId: 'cu-memory', productId: 'p-knit', campaignId: PREV_ID,
        source: { kind: 'tracked', channel: 'whatsapp_status', detail: 'Came through the tracked link on your WhatsApp Status.' },
        stage: 'replied', created: addDays(today, -6),
        messages: [
          { from: 'customer', date: addDays(today, -6), text: 'Love the knit set! Will it come in other colours?' },
          { from: 'shop', date: addDays(today, -6), text: 'Thank you Memory! We are hoping to get more colours soon. I can let you know when they arrive.' },
          { from: 'customer', date: addDays(today, -6), text: 'Yes please!' },
        ],
        question: 'Wants to know when new colours arrive.',
        suggestedReply: 'Hi Memory, you asked us to tell you about new colours. Our new Occasion Edit has just arrived. Would you like to see it?',
        suggestionPromo: true,
        followUp: { date: today, kind: 'promo', note: 'She asked to hear when new colours arrive.' },
        script: [],
      },
      {
        id: 'e-grace', customerId: 'cu-grace', productId: 'p-olive-dress', campaignId: null,
        source: { kind: 'reported', channel: 'referrals', detail: 'She said a friend recommended VYRA.' },
        stage: 'won', created: addDays(today, -8), saleId: 's3',
        messages: [
          { from: 'customer', date: addDays(today, -8), text: 'Hello, my friend told me about you. I want the olive print dress in a 16.' },
          { from: 'shop', date: addDays(today, -8), text: 'Welcome Grace! Yes, we have a 16. I will send you the details now.' },
          { from: 'customer', date: addDays(today, -6), text: 'Received, thank you. Please don’t send me promotions, I only want order updates.' },
        ],
        question: 'Asked not to receive promotions.',
        suggestedReply: 'Hi Grace, just checking the olive print dress fits well. Let us know if you need anything.',
        followUp: { date: today, kind: 'service', note: 'Check the dress fits well.' },
        script: [],
      },
      {
        id: 'e-nyasha', customerId: 'cu-nyasha', productId: 'p-jumpsuit', campaignId: PREV_ID,
        source: { kind: 'tracked', channel: 'instagram', detail: 'Came through the tracked link on the Instagram post.' },
        stage: 'won', created: addDays(prevStart, 2), saleId: 's1',
        messages: [
          { from: 'customer', date: addDays(prevStart, 2), text: 'Hi, I bought the olive dress last time. Is the jumpsuit available in a 10?' },
          { from: 'shop', date: addDays(prevStart, 2), text: 'Welcome back Nyasha! Yes, size 10 is available.' },
          { from: 'customer', date: addDays(prevStart, 3), text: 'I’ll take it.' },
        ],
        question: 'Ordered the jumpsuit in size 10.', suggestedReply: 'Thank you Nyasha! We will be in touch about delivery.', script: [],
      },
      {
        id: 'e-chipo', customerId: 'cu-chipo', productId: 'p-knit', campaignId: PREV_ID,
        source: { kind: 'reported', channel: 'facebook', detail: 'She said she saw it on Facebook. No tracked link was used.' },
        stage: 'won', created: addDays(prevStart, 5), saleId: 's2',
        messages: [{ from: 'customer', date: addDays(prevStart, 5), text: 'Saw your knit set on Facebook. I want it in medium.' }],
        question: 'Ordered the knit set in medium.', suggestedReply: 'Thank you Chipo!', script: [],
      },
      {
        id: 'e-farai', customerId: 'cu-farai', productId: 'p-knit', campaignId: PREV_ID,
        source: { kind: 'tracked', channel: 'instagram', detail: 'Came through the tracked link on the Instagram post.' },
        stage: 'lost', created: addDays(prevStart, 1), lostReason: 'Her size was not available.',
        messages: [{ from: 'customer', date: addDays(prevStart, 1), text: 'Do you have the knit set in XXL?' }],
        question: 'Wanted size XXL.', suggestedReply: '', script: [],
      },
      {
        id: 'e-ruvimbo', customerId: 'cu-ruvimbo', productId: 'p-jumpsuit', campaignId: PREV_ID,
        source: { kind: 'tracked', channel: 'meta_ads', detail: 'Came through the tracked link on the Facebook and Instagram ad.' },
        stage: 'lost', created: addDays(prevStart, 9), lostReason: 'Stopped replying.',
        messages: [{ from: 'customer', date: addDays(prevStart, 9), text: 'How much is the jumpsuit?' }, { from: 'shop', date: addDays(prevStart, 9), text: 'Hi Ruvimbo, it is $68. Which size do you need?' }],
        question: 'Asked the price.', suggestedReply: '', script: [],
      },
    ],
    sales: [
      { id: 's0', date: addDays(today, -40), customerId: 'cu-nyasha', productId: 'p-olive-dress', amount: 70, enquiryId: null, campaignId: null, source: { kind: 'unknown' } },
      { id: 's1', date: addDays(prevStart, 3), customerId: 'cu-nyasha', productId: 'p-jumpsuit', amount: 68, enquiryId: 'e-nyasha', campaignId: PREV_ID, source: { kind: 'tracked', channel: 'instagram' } },
      { id: 's2', date: addDays(prevStart, 5), customerId: 'cu-chipo', productId: 'p-knit', amount: 60, enquiryId: 'e-chipo', campaignId: PREV_ID, source: { kind: 'reported', channel: 'facebook' } },
      { id: 's3', date: addDays(today, -7), customerId: 'cu-grace', productId: 'p-olive-dress', amount: 70, enquiryId: 'e-grace', campaignId: null, source: { kind: 'reported', channel: 'referrals' } },
      { id: 's5', date: addDays(today, -9), customerId: 'cu-walkin', productId: 'p-lime', amount: 65, enquiryId: null, campaignId: null, source: { kind: 'unknown' } },
    ],
    log: [
      { id: 'l1', date: prevEnd, text: `Campaign "${COLLECTIONS.newIn.name}" finished.` },
    ],
    seq: 100,
  };
}
