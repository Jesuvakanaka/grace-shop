// VYRA Marketing hub (ZP-1200): the channel registry. Pure data, no secrets.
// Kinds are strings, so a new channel needs no migration. Facts verified Nov 2026.

export type ChannelFamily = 'meta' | 'whatsapp' | 'google' | 'video' | 'social' | 'messages' | 'partners' | 'offline'
export type ChannelMode = 'api' | 'manual'
export type PostFormat = 'POST' | 'STORY' | 'REEL' | 'CAROUSEL' | 'MESSAGE' | 'PIN' | 'VIDEO' | 'EMAIL' | 'SMS' | 'AD'
export const POST_FORMATS: readonly PostFormat[] = ['POST', 'STORY', 'REEL', 'CAROUSEL', 'MESSAGE', 'PIN', 'VIDEO', 'EMAIL', 'SMS', 'AD']

export interface ChannelDef {
  kind: string
  label: string
  family: ChannelFamily
  mode: ChannelMode
  formats: readonly PostFormat[]
  capabilities: { publish: boolean; schedule: boolean; ads: boolean; catalog: boolean; messages: boolean; insights: boolean }
  limits: { maxText: number; maxHashtags: number; needsImage: boolean; imageFormat: 'jpeg' | 'any'; maxImages: number }
  /** A connector exists in code for this channel yet. */
  connector: boolean
  /** Plain-English steps the owner follows to switch it on. */
  setupSteps: readonly string[]
  /** What the official API cannot do. */
  apiNotes: readonly string[]
}

type Caps = Partial<ChannelDef['capabilities']>
type Lims = Partial<ChannelDef['limits']>

function def(
  kind: string,
  label: string,
  family: ChannelFamily,
  mode: ChannelMode,
  formats: readonly PostFormat[],
  caps: Caps,
  limits: Lims,
  setupSteps: readonly string[],
  apiNotes: readonly string[],
): ChannelDef {
  return {
    kind,
    label,
    family,
    mode,
    formats,
    capabilities: { publish: false, schedule: false, ads: false, catalog: false, messages: false, insights: false, ...caps },
    limits: { maxText: 2000, maxHashtags: 30, needsImage: false, imageFormat: 'any', maxImages: 1, ...limits },
    connector: false,
    setupSteps,
    apiNotes,
  }
}

const META_PAGE_STEPS = [
  'Open Meta Business Suite, Business settings (business.facebook.com/settings) and add the VYRA Page (and the Instagram account) to your business.',
  'Go to Users, System users, and add a system user (Admin role). Assign it the Page with full control.',
  'Press Generate token, choose your app, set the expiry to Never, and tick pages_manage_posts, pages_read_engagement, instagram_basic and instagram_content_publish.',
  'Copy the token and the Page ID (Page, About, Page transparency) and paste both into the Connect box here. The token is saved encrypted and never shown again.',
  'Turn on live posting in the settings only when you are ready: nothing goes out until you switch it on and approve each post.',
]

const MANUAL_NOTE = 'No official API: the hub prepares the words and photos and you post them yourself, then mark it as shared.'

/** Channels with a connector in src/lib/marketing/connectors. */
const WITH_CONNECTOR = new Set(['FACEBOOK_PAGE', 'INSTAGRAM', 'META_ADS', 'PINTEREST', 'TELEGRAM', 'X', 'YOUTUBE', 'TIKTOK'])

export const CHANNELS: readonly ChannelDef[] = [
  def('FACEBOOK_PAGE', 'Facebook Page', 'meta', 'api', ['POST', 'STORY', 'VIDEO'],
    { publish: true, schedule: true, insights: true }, { maxText: 5000, maxHashtags: 10, maxImages: 10 },
    META_PAGE_STEPS,
    ['Posting needs the pages_manage_posts permission, which Meta reviews before it works for the public.', 'The hub posts text, a link, or one or more photos. Stories and videos are not published automatically yet.', 'Reach and clicks come back; the names of people who reacted do not.']),
  def('INSTAGRAM', 'Instagram', 'meta', 'api', ['POST', 'STORY', 'REEL', 'CAROUSEL'],
    { publish: true, schedule: true, insights: true }, { maxText: 2200, maxHashtags: 30, needsImage: true, imageFormat: 'jpeg', maxImages: 10 },
    ['Switch the VYRA Instagram account to a Business or Creator account (Settings, Account type).', 'Link it to the VYRA Facebook Page (Page settings, Linked accounts).', ...META_PAGE_STEPS],
    ['The Instagram API publishes JPEG photos only (the hub converts the photos for you).', 'No shopping tags, no filters, no music. Links in a caption are not clickable.', 'At most 50 posts in 24 hours. Reels need a video and are not published automatically yet.']),
  def('THREADS', 'Threads', 'meta', 'api', ['POST'],
    { publish: true, insights: true }, { maxText: 500, maxHashtags: 1, maxImages: 10 },
    ['Make sure the VYRA Instagram account has a Threads profile.', 'In your Meta developer app add the Threads API and create a token for the profile.', 'Paste the token into the Connect box.'],
    ['Text limit is 500 characters and only one topic tag per post.', 'No scheduling through the API: the hub holds the post until it is due.']),
  def('META_ADS', 'Facebook and Instagram ads', 'meta', 'api', ['AD'],
    { publish: true, ads: true, insights: true }, { maxText: 2000, needsImage: true, maxImages: 10 },
    ['In Meta Business Settings, Accounts, Ad accounts, add (or create) the VYRA ad account.', 'Add a payment method that works from Zimbabwe (Billing, Payment methods). Test with a $1 a day boost first.', 'Users, System users: add a system user, assign it the ad account and the Page, then generate a token with ads_management and ads_read (expiry Never). Standard access is enough for your own ad account.', 'Paste the ad account ID (act_123456789), the Page ID and the token into the Connect box. The token is saved encrypted and never shown again.', 'Set a monthly spend cap in the hub settings. Without one, no ad can be created. Use a USD ad account.'],
    ['Ads are always created paused and need a second approval to switch on.', 'Targeting for housing, jobs and credit is restricted; children\'s clothing ads must target adults (parents).']),
  def('FACEBOOK_GROUPS', 'Facebook Groups', 'meta', 'manual', ['POST'],
    {}, { maxText: 5000, maxImages: 10 }, ['Join the local buying and selling groups you want to use.', 'Open the prepared post here, copy the words and photos, post in the group, then press "Mark as shared".'],
    ['The Facebook Groups API was removed in April 2024.', MANUAL_NOTE, 'Read each group\'s rules before posting.']),
  def('FACEBOOK_MARKETPLACE', 'Facebook Marketplace', 'meta', 'manual', ['POST'],
    {}, { maxText: 5000, maxImages: 10, needsImage: true }, ['Open Facebook, Marketplace, Create new listing.', 'Copy the prepared title, words and photos, then press "Mark as shared" here.'],
    ['Marketplace listings cannot be created through the API for a normal shop.', MANUAL_NOTE]),
  def('WHATSAPP_STATUS', 'WhatsApp Status', 'whatsapp', 'manual', ['STORY'],
    {}, { maxText: 700, maxImages: 1 }, ['Save the prepared photo to your phone.', 'Post it to your WhatsApp Status with the caption, then press "Mark as shared".'],
    ['WhatsApp has no API for Status.', MANUAL_NOTE]),
  def('WHATSAPP_CHANNEL', 'WhatsApp Channel', 'whatsapp', 'manual', ['POST'],
    {}, { maxText: 2000, maxImages: 1 }, ['Create a VYRA Channel in WhatsApp (Updates tab, plus button).', 'Post the prepared update from the app, then press "Mark as shared".'],
    ['WhatsApp has no API for Channels.', MANUAL_NOTE]),
  def('WHATSAPP_BROADCAST', 'WhatsApp broadcast lists', 'whatsapp', 'manual', ['MESSAGE'],
    {}, { maxText: 1000, maxImages: 1 }, ['Create a broadcast list in WhatsApp with customers who saved your number.', 'Send the prepared message from the app, then press "Mark as shared".'],
    ['WhatsApp has no API for broadcast lists.', 'Moving the number onto the Cloud API ("coexistence") makes broadcast lists read-only in the app.', MANUAL_NOTE]),
  def('WHATSAPP_CLOUD', 'WhatsApp Business (Cloud API)', 'whatsapp', 'api', ['MESSAGE'],
    { publish: true, messages: true }, { maxText: 1024, maxImages: 1 },
    ['Create a Meta business and add the WhatsApp product to your developer app.', 'Add a phone number and get the phone number ID and a permanent token.', 'Submit message templates for approval in WhatsApp Manager.', 'Paste the phone number ID and token into the Connect box.'],
    ['You can only message customers who opted in.', 'Outside the 24-hour reply window only approved templates can be sent, and each conversation is charged by Meta.', 'Using the number here changes how the WhatsApp app behaves on that number (broadcast lists become read-only).']),
  def('GOOGLE_BUSINESS', 'Google Business Profile', 'google', 'api', ['POST'],
    { publish: true, insights: true }, { maxText: 1500, maxHashtags: 0, maxImages: 1 },
    ['Claim the VYRA listing at business.google.com.', 'Request access to the Business Profile APIs in Google Cloud and create OAuth credentials.', 'Paste the refresh token and the location ID into the Connect box.'],
    ['API access has to be requested from Google and can take days.', 'Posts last 7 days unless they are events or offers.']),
  def('GOOGLE_MERCHANT', 'Google Merchant Center (free listings)', 'google', 'api', ['POST'],
    { publish: true, catalog: true, insights: true }, { maxText: 5000, needsImage: true, maxImages: 10 },
    ['Create a Merchant Center account and verify the VYRA website.', 'Create a Google Cloud service account and add it as a user in Merchant Center.', 'Paste the service account key and merchant ID into the Connect box.'],
    ['The old Content API ended on 18 August 2026: the hub uses the Merchant API.', 'Products appear only after Google reviews them, which can take days.']),
  def('GOOGLE_ADS', 'Google Ads', 'google', 'api', ['AD'],
    { publish: true, ads: true, insights: true }, { maxText: 90, maxHashtags: 0, maxImages: 1 },
    ['Create a Google Ads account with a payment method.', 'Apply for a developer token (Tools, API Center). Google reviews it.', 'Create OAuth credentials and paste the refresh token and customer ID into the Connect box.', 'Set a monthly spend cap in the hub settings.'],
    ['A basic developer token is needed for real accounts and Google reviews it.', 'Ads are always created paused and need a second approval to switch on.']),
  def('YOUTUBE', 'YouTube', 'video', 'api', ['VIDEO', 'REEL'],
    { publish: true, schedule: true, insights: true }, { maxText: 5000, maxHashtags: 15, maxImages: 1 },
    ['Create a YouTube channel for VYRA.', 'In Google Cloud enable the YouTube Data API and create OAuth credentials.', 'Paste the refresh token into the Connect box.'],
    ['New API projects must pass an audit before uploads are public; until then uploads stay private.', 'Default quota is 100 uploads per day per project (checked 26 Nov 2026).', 'Google may keep uploads from unaudited API projects private: check the first upload in YouTube Studio. The hub uploads as unlisted unless you set the channel to public.', 'Every post needs a video file; photos alone cannot be uploaded.']),
  def('TIKTOK', 'TikTok', 'video', 'api', ['VIDEO', 'REEL'],
    { publish: true, insights: true }, { maxText: 2200, maxHashtags: 10, maxImages: 1 },
    ['Create a TikTok developer account and a "Content Posting" app.', 'Connect the VYRA TikTok account and paste the token into the Connect box.', 'Drafts arrive in your TikTok inbox: open the app and press Post.'],
    ['TikTok keeps posts from unaudited apps private and does not audit tools for your own account.', 'So the hub sends drafts to the TikTok inbox and you post them from the TikTok app.', 'Video drafts carry only the video: type the caption in the TikTok app. Photo drafts carry a title and description.', 'TikTok allows 5 waiting drafts per 24 hours, and the website domain must be verified in the TikTok developer portal.']),
  def('PINTEREST', 'Pinterest', 'social', 'api', ['PIN'],
    { publish: true, insights: true }, { maxText: 500, maxHashtags: 20, needsImage: true, maxImages: 1 },
    ['Create a Pinterest Business account and claim the VYRA website.', 'Create a Pinterest developer app and a token with pins:write.', 'Paste the token and the board ID into the Connect box.'],
    ['New apps start with trial access, which Pinterest must upgrade before pins are public.', 'Each pin goes to one board, needs a picture, a title up to 100 characters and a description up to 800.']),
  def('X', 'X (Twitter)', 'social', 'api', ['POST'],
    { publish: true, insights: true }, { maxText: 280, maxHashtags: 2, maxImages: 4 },
    ['Create an X developer account and a project with write access.', 'Add credit to the developer account (pay per use).', 'Paste the keys and tokens into the Connect box.'],
    ['Costs $0.015 per post, and $0.20 for a post with a link (pay per use, checked 26 Nov 2026). The hub shows the expected cost with each result.', 'Text limit is 280 characters and a link counts as 23.', 'Up to 4 photos per post; no video yet.']),
  def('TELEGRAM', 'Telegram channel', 'social', 'api', ['POST'],
    { publish: true, schedule: true }, { maxText: 4096, maxImages: 10 },
    ['Create a Telegram channel for VYRA.', 'Talk to @BotFather to create a bot and copy its token.', 'Add the bot as an administrator of the channel.', 'Paste the token and the channel name into the Connect box.'],
    ['The bot API cannot report views for a channel.', 'Photo captions are limited to 1024 characters: a longer text is sent as a message right after the photos.', 'A media group holds 2 to 10 photos.']),
  def('EMAIL', 'Email newsletter', 'messages', 'api', ['EMAIL'],
    { publish: true, messages: true }, { maxText: 20000, maxHashtags: 0, maxImages: 5 },
    ['Pick an email sending service (for example Resend or Mailgun) and verify the VYRA domain.', 'Paste the API key and the "from" address into the Connect box.', 'Only people who agreed to hear from VYRA may be emailed.'],
    ['Every email needs an unsubscribe link and a postal address.', 'Sending to a list needs consent that the hub records.']),
  def('SMS', 'Text messages (SMS)', 'messages', 'api', ['SMS'],
    { publish: true, messages: true }, { maxText: 320, maxHashtags: 0, maxImages: 0 },
    ['Pick an SMS provider (for example Twilio) and buy a sender number.', 'Paste the account ID, the token and the sender number into the Connect box.'],
    ['Each message costs money and only people who agreed to be texted may receive one.', 'Some countries need the sender name registered first.']),
  def('INFLUENCER', 'Influencers', 'partners', 'manual', ['MESSAGE'],
    {}, { maxText: 2000, maxImages: 5 }, ['Agree with the person what they will post and what they get.', 'Send them the prepared brief and the photos, then press "Mark as shared".'],
    ['Nothing is posted by the hub. Use a tracking link or a code per person to see results.', 'Ask them to label paid posts as ads.']),
  def('RESELLER', 'Resellers and partners', 'partners', 'manual', ['MESSAGE'],
    {}, { maxText: 2000, maxImages: 10 }, ['Send the prepared product pack to the reseller (WhatsApp or email).', 'Press "Mark as shared" once it is sent.'],
    [MANUAL_NOTE, 'Give each reseller their own tracking link to see what they bring in.']),
  def('CLASSIFIEDS', 'Online classifieds', 'offline', 'manual', ['POST'],
    {}, { maxText: 1500, maxImages: 10 }, ['Open the classifieds site you use (for example Gumtree or a local board).', 'Copy the prepared advert, post it, then press "Mark as shared".'],
    [MANUAL_NOTE]),
  def('PRINT_QR', 'Print and QR codes', 'offline', 'manual', ['POST'],
    {}, { maxText: 300, maxHashtags: 0, maxImages: 1 }, ['Print the QR code and tag line on flyers, bags or the shop window.', 'Each print run has its own tracking link, so scans show up in the results.'],
    ['Scans are counted as visits with the tracking tag; walk-ins cannot be tracked.']),
].map((c) => (WITH_CONNECTOR.has(c.kind) ? { ...c, connector: true } : c))

const BY_KIND = new Map(CHANNELS.map((c) => [c.kind, c]))

export const CHANNEL_KINDS: readonly string[] = CHANNELS.map((c) => c.kind)

export function getChannel(kind: string): ChannelDef | undefined {
  return BY_KIND.get(kind)
}

export function isChannelKind(kind: unknown): kind is string {
  return typeof kind === 'string' && BY_KIND.has(kind)
}

export const CHANNEL_STATUSES = ['NOT_CONNECTED', 'CONNECTED', 'ERROR', 'MANUAL'] as const
