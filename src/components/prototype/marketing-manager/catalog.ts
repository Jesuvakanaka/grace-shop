// AI Marketing Manager prototype: fixed sample catalogue, channels and formats.
// Everything here is fictional demonstration data. Prices are sample prices,
// not the shop's real prices. Channel facts reuse the hub's channel registry
// (src/lib/marketing/channels.ts) where one exists.
import { getChannel } from '@/lib/marketing/channels';

export interface SampleProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  /** Short fit / fabric note the copy may use. Only facts we show as sample data. */
  note: string;
}

const img = (slug: string) => `/brand/lookbook/${slug}-640.webp`;

export const PRODUCTS: readonly SampleProduct[] = [
  { id: 'p-lime', name: 'Lime pleated midi dress', price: 65, image: img('lime-pleated-dress'), note: 'Soft pleats, puff sleeves and a belted waist.' },
  { id: 'p-olive-dress', name: 'Olive print pleated dress', price: 70, image: img('olive-print-pleated-dress'), note: 'Flowing print with a tie neck.' },
  { id: 'p-bronze', name: 'Bronze pleated set', price: 85, image: img('bronze-pleated-set'), note: 'Metallic pleated skirt with a matching top.' },
  { id: 'p-jumpsuit', name: 'Olive print jumpsuit', price: 68, image: img('olive-print-jumpsuit'), note: 'Wide legs and a wrap tie at the waist.' },
  { id: 'p-knit', name: 'Chartreuse fringe knit set', price: 60, image: img('chartreuse-fringe-knit-set'), note: 'Knit top and skirt with fringe trim.' },
];

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0];

export const COLLECTIONS = {
  occasion: { name: 'The Occasion Edit', productIds: ['p-lime', 'p-olive-dress', 'p-bronze'] },
  newIn: { name: 'New in: knit set and jumpsuit', productIds: ['p-jumpsuit', 'p-knit'] },
  bestsellers: { name: 'Customer favourites', productIds: ['p-jumpsuit', 'p-olive-dress', 'p-knit'] },
} as const;

// ---------------------------------------------------------------- channels

export type ChannelId =
  | 'instagram' | 'facebook' | 'meta_ads' | 'tiktok' | 'facebook_groups' | 'whatsapp_status' | 'whatsapp_channel'
  | 'whatsapp_business' | 'pinterest' | 'youtube' | 'threads' | 'x' | 'whatsapp_broadcast' | 'email' | 'sms'
  | 'google_business' | 'google_merchant' | 'google_ads' | 'facebook_marketplace' | 'classifieds'
  | 'influencers' | 'resellers' | 'referrals' | 'print_qr';

export type ChannelGroup = 'discovery' | 'direct' | 'search' | 'partners';

export const GROUP_LABEL: Record<ChannelGroup, { title: string; hint: string }> = {
  discovery: { title: 'Get discovered on social media', hint: 'Places where new people scroll and find you.' },
  direct: { title: 'Talk to customers directly', hint: 'Messages to people who already know you or asked to hear from you.' },
  search: { title: 'Be found in searches and catalogues', hint: 'Show up when people look for clothes like yours.' },
  partners: { title: 'Partners and referrals', hint: 'Other people who help spread the word.' },
};

/** How the prototype depicts the channel. */
export type Depiction = 'automatic' | 'manual' | 'future';

/** Demo connection status. Nothing here is ever a real connection. */
export type DemoConnection = 'connected' | 'expired' | 'not_connected' | 'manual';

export interface ChannelInfo {
  id: ChannelId;
  name: string;
  group: ChannelGroup;
  depiction: Depiction;
  helps: string;
  needs: string;
  /** Plain-English caution: what this channel can not do automatically, or what is unproven. */
  caution?: string;
  /** Kind in the hub's channel registry, when one exists. */
  registryKind?: string;
}

export const CHANNELS: readonly ChannelInfo[] = [
  // Social discovery
  { id: 'instagram', name: 'Instagram', group: 'discovery', depiction: 'automatic', registryKind: 'INSTAGRAM',
    helps: 'Shows your pieces to new people through photos, short videos and stories.',
    needs: 'Good photos or short videos, a caption and a few hashtags.',
    caution: 'Photo posts and stories are shown as automatic. Reels need a video and are shown as something you post yourself in a real launch.' },
  { id: 'facebook', name: 'Facebook Page', group: 'discovery', depiction: 'automatic', registryKind: 'FACEBOOK_PAGE',
    helps: 'Reaches people who use Facebook more than Instagram, often an older audience.',
    needs: 'Photos and a slightly longer caption.' },
  { id: 'meta_ads', name: 'Facebook and Instagram ads', group: 'discovery', depiction: 'automatic', registryKind: 'META_ADS',
    helps: 'Pays to show a post to more of the right people in your delivery area.',
    needs: 'One strong photo, a short message, a daily budget and a spending limit.',
    caution: 'Spends real money in a real launch. In this prototype the spending is pretend.' },
  { id: 'tiktok', name: 'TikTok', group: 'discovery', depiction: 'manual', registryKind: 'TIKTOK',
    helps: 'Short styling videos can reach many new people quickly.',
    needs: 'A short vertical video (try-on, styling or behind the scenes).',
    caution: 'TikTok only accepts drafts from tools like this, so you finish each post in the TikTok app.' },
  { id: 'whatsapp_status', name: 'WhatsApp Status', group: 'discovery', depiction: 'manual', registryKind: 'WHATSAPP_STATUS',
    helps: 'Your saved contacts see your newest pieces when they check Status.',
    needs: 'One photo and a short line of text.',
    caution: 'WhatsApp has no way for tools to post a Status, so you post it from your phone.' },
  { id: 'pinterest', name: 'Pinterest', group: 'discovery', depiction: 'automatic', registryKind: 'PINTEREST',
    helps: 'People save outfit ideas for later, which keeps bringing visits over time.',
    needs: 'A tall photo, a title and a short description.' },
  { id: 'youtube', name: 'YouTube', group: 'discovery', depiction: 'future', registryKind: 'YOUTUBE',
    helps: 'Longer try-on and styling videos that people find by searching.',
    needs: 'A video for every post.',
    caution: 'Not part of this prototype’s journey yet.' },
  { id: 'threads', name: 'Threads', group: 'discovery', depiction: 'future', registryKind: 'THREADS',
    helps: 'Short text updates for people who already follow you on Instagram.',
    needs: 'A short text, one photo at most.',
    caution: 'Not part of this prototype’s journey yet.' },
  { id: 'x', name: 'X (Twitter)', group: 'discovery', depiction: 'future', registryKind: 'X',
    helps: 'Short updates and links.',
    needs: 'Very short text (280 characters).',
    caution: 'Charges a small fee per post in a real launch. Not part of this prototype’s journey yet.' },
  { id: 'facebook_groups', name: 'Facebook Groups', group: 'discovery', depiction: 'manual', registryKind: 'FACEBOOK_GROUPS',
    helps: 'Local buying and selling groups where shoppers look for clothes.',
    needs: 'A photo post that follows each group’s rules.',
    caution: 'Facebook no longer lets tools post in groups, so you post it yourself.' },

  // Direct customer communication
  { id: 'whatsapp_business', name: 'WhatsApp messages', group: 'direct', depiction: 'automatic', registryKind: 'WHATSAPP_CLOUD',
    helps: 'Sends a message to people who agreed to hear from you, such as past customers.',
    needs: 'A short message that WhatsApp approves in advance, and customers who said yes to messages.',
    caution: 'Only people who agreed to marketing messages can receive them. Each message has a small cost in a real launch.' },
  { id: 'whatsapp_channel', name: 'WhatsApp Channel', group: 'direct', depiction: 'manual', registryKind: 'WHATSAPP_CHANNEL',
    helps: 'One-way updates for followers who chose to follow your shop.',
    needs: 'A photo and a short update.',
    caution: 'Posted by you from the WhatsApp app.' },
  { id: 'whatsapp_broadcast', name: 'WhatsApp broadcast lists', group: 'direct', depiction: 'manual', registryKind: 'WHATSAPP_BROADCAST',
    helps: 'A message to a list of customers who saved your number.',
    needs: 'A short message and one photo.',
    caution: 'Sent by you from the WhatsApp app.' },
  { id: 'email', name: 'Email newsletter', group: 'direct', depiction: 'future', registryKind: 'EMAIL',
    helps: 'A regular round-up for people who gave you their email address.',
    needs: 'A subject line, a few photos and short text.',
    caution: 'Not part of this prototype’s journey yet. Few of your customers have shared an email so far (assumption).' },
  { id: 'sms', name: 'Text messages (SMS)', group: 'direct', depiction: 'future', registryKind: 'SMS',
    helps: 'A short reminder that reaches phones without data.',
    needs: 'A very short message.',
    caution: 'Costs money per message and needs checking for Zimbabwe numbers. Not part of this prototype’s journey yet.' },

  // Search and catalogues
  { id: 'google_business', name: 'Google Business Profile', group: 'search', depiction: 'automatic', registryKind: 'GOOGLE_BUSINESS',
    helps: 'Shows your shop when people search Google or Maps for clothing shops nearby.',
    needs: 'A short update with one photo and a button.',
    caution: 'Google has to approve access first, which can take days.' },
  { id: 'google_merchant', name: 'Google Shopping listings', group: 'search', depiction: 'future', registryKind: 'GOOGLE_MERCHANT',
    helps: 'Lists your products when people search for them on Google.',
    needs: 'Each product with a photo and a visible price.',
    caution: 'Needs prices on every product and a Google review. Shown here as a future option.' },
  { id: 'google_ads', name: 'Google search ads', group: 'search', depiction: 'future', registryKind: 'GOOGLE_ADS',
    helps: 'Pays to appear when people search for words like “occasion dresses Harare”.',
    needs: 'Short headlines, search words and a daily budget.',
    caution: 'Spends real money and needs Google’s approval. Shown here as a future option.' },
  { id: 'facebook_marketplace', name: 'Facebook Marketplace', group: 'search', depiction: 'manual', registryKind: 'FACEBOOK_MARKETPLACE',
    helps: 'Shoppers browse Marketplace for local fashion.',
    needs: 'A listing with title, photos and price.',
    caution: 'You create each listing yourself in Facebook.' },
  { id: 'classifieds', name: 'Online classifieds', group: 'search', depiction: 'manual', registryKind: 'CLASSIFIEDS',
    helps: 'Local listing sites where people search for items.',
    needs: 'A short advert with photos.' },

  // Partnerships and referrals
  { id: 'influencers', name: 'Local creators and influencers', group: 'partners', depiction: 'manual', registryKind: 'INFLUENCER',
    helps: 'Someone your customers trust shows your pieces to their followers.',
    needs: 'A short brief, photos and an agreement on what they get.',
    caution: 'Paid posts must be labelled as ads by the creator.' },
  { id: 'resellers', name: 'Resellers and stylists', group: 'partners', depiction: 'manual', registryKind: 'RESELLER',
    helps: 'People who sell or recommend your pieces to their own customers.',
    needs: 'A product pack with photos and prices.' },
  { id: 'referrals', name: 'Customer referrals', group: 'partners', depiction: 'future',
    helps: 'Happy customers share a personal code with friends.',
    needs: 'A simple reward and a code per customer.',
    caution: 'A future idea. Not built anywhere yet.' },
  { id: 'print_qr', name: 'Print and QR codes', group: 'partners', depiction: 'manual', registryKind: 'PRINT_QR',
    helps: 'Flyers, bags and tags that lead people to your shop online.',
    needs: 'A QR code and one short line.' },
];

export const channelById = (id: ChannelId): ChannelInfo => CHANNELS.find((c) => c.id === id)!;

/** Character limit from the hub registry, if the channel has one. */
export function textLimit(id: ChannelId): number | null {
  const kind = channelById(id).registryKind;
  return kind ? getChannel(kind)?.limits.maxText ?? null : null;
}

/** Starting demo connection status per channel. Facebook is deliberately "expired" to show a recoverable failure. */
export const INITIAL_CONNECTIONS: Record<ChannelId, DemoConnection> = Object.fromEntries(
  CHANNELS.map((c) => {
    if (c.id === 'facebook') return [c.id, 'expired'];
    if (c.id === 'instagram' || c.id === 'meta_ads' || c.id === 'whatsapp_business') return [c.id, 'connected'];
    if (c.depiction === 'manual') return [c.id, 'manual'];
    return [c.id, 'not_connected'];
  }),
) as Record<ChannelId, DemoConnection>;

// ---------------------------------------------------------------- formats

export type FormatId = 'ig_post' | 'ig_story' | 'ig_reel' | 'fb_post' | 'ad' | 'tiktok_video' | 'fb_group' | 'wa_status' | 'wa_channel' | 'wa_message';

export interface FormatInfo {
  id: FormatId;
  channel: ChannelId;
  label: string;
  shape: 'square' | 'tall' | 'post' | 'chat';
  /** True when the prototype depicts the platform publishing it for you (once connected). */
  auto: boolean;
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  ig_post: { id: 'ig_post', channel: 'instagram', label: 'Instagram post', shape: 'square', auto: true },
  ig_story: { id: 'ig_story', channel: 'instagram', label: 'Instagram story', shape: 'tall', auto: true },
  ig_reel: { id: 'ig_reel', channel: 'instagram', label: 'Instagram reel', shape: 'tall', auto: false },
  fb_post: { id: 'fb_post', channel: 'facebook', label: 'Facebook post', shape: 'post', auto: true },
  ad: { id: 'ad', channel: 'meta_ads', label: 'Facebook and Instagram ad', shape: 'square', auto: true },
  tiktok_video: { id: 'tiktok_video', channel: 'tiktok', label: 'TikTok video', shape: 'tall', auto: false },
  fb_group: { id: 'fb_group', channel: 'facebook_groups', label: 'Facebook Group post', shape: 'post', auto: false },
  wa_status: { id: 'wa_status', channel: 'whatsapp_status', label: 'WhatsApp Status', shape: 'tall', auto: false },
  wa_channel: { id: 'wa_channel', channel: 'whatsapp_channel', label: 'WhatsApp Channel update', shape: 'chat', auto: false },
  wa_message: { id: 'wa_message', channel: 'whatsapp_business', label: 'WhatsApp message', shape: 'chat', auto: true },
};

/** Sample results each format brings when it goes out in the demo. Fixed numbers so totals reconcile. */
export const FORMAT_SAMPLE_RESULTS: Record<FormatId, { reach: number; visits: number; clicks: number }> = {
  ig_post: { reach: 1480, visits: 74, clicks: 11 },
  ig_story: { reach: 960, visits: 58, clicks: 13 },
  ig_reel: { reach: 2240, visits: 66, clicks: 8 },
  fb_post: { reach: 620, visits: 22, clicks: 4 },
  ad: { reach: 0, visits: 0, clicks: 0 }, // ads report per day while running, see AD_DAILY_RESULTS
  tiktok_video: { reach: 1900, visits: 41, clicks: 5 },
  fb_group: { reach: 430, visits: 19, clicks: 5 },
  wa_status: { reach: 180, visits: 16, clicks: 7 },
  wa_channel: { reach: 140, visits: 12, clicks: 3 },
  wa_message: { reach: 0, visits: 0, clicks: 0 }, // reach = recipients, set when sent
};

/** Per day of a running ad, per $1 of daily spend. */
export const AD_DAILY_RESULTS_PER_DOLLAR = { reach: 90, visits: 4, clicks: 0.5 };

/** Example WhatsApp marketing message rate. Not checked with WhatsApp: shown as an estimate. */
export const WHATSAPP_RATE = 0.04;

/** People on the sample contact list who agreed to WhatsApp marketing (not counting the sample enquiry customers). */
export const SAMPLE_OPTED_IN_LIST = 36;
