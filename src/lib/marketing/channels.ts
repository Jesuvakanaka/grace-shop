// VYRA Marketing hub (ZP-1200): the channel registry. Pure data, no secrets.
// Kinds are strings, so a new channel needs no migration. Facts verified Nov 2026.

export type ChannelFamily = 'meta' | 'whatsapp' | 'google' | 'video' | 'social' | 'messages' | 'partners' | 'offline'
export type ChannelMode = 'api' | 'manual'
export type PostFormat = 'POST' | 'STORY' | 'REEL' | 'CAROUSEL' | 'MESSAGE' | 'PIN' | 'VIDEO' | 'EMAIL' | 'SMS' | 'AD'
export const POST_FORMATS: readonly PostFormat[] = ['POST', 'STORY', 'REEL', 'CAROUSEL', 'MESSAGE', 'PIN', 'VIDEO', 'EMAIL', 'SMS', 'AD']

/** One box of the Connect form. `digits` = a number such as a Page ID; `text` = an ID or name; `secret` = a token or key (never shown again). */
export interface ConnectField {
  name: string
  label: string
  kind: 'digits' | 'text' | 'secret'
  help?: string
  max?: number
}

const PAGE_ID: ConnectField = { name: 'pageId', label: 'Facebook Page ID', kind: 'digits', max: 40 }
const ACCESS_TOKEN: ConnectField = { name: 'accessToken', label: 'Access token', kind: 'secret', max: 1000, help: 'It is checked with Meta, saved encrypted, and never shown again.' }
const GOOGLE_OAUTH: readonly ConnectField[] = [
  { name: 'clientId', label: 'OAuth client ID', kind: 'text', max: 200 },
  { name: 'clientSecret', label: 'OAuth client secret', kind: 'secret', max: 200 },
  { name: 'refreshToken', label: 'Refresh token', kind: 'secret', max: 1000, help: 'It is checked with Google, saved encrypted, and never shown again.' },
]

/** The Connect form fields per kind. Kinds not listed have no connect form yet. */
export const CONNECT_FIELDS: Readonly<Record<string, readonly ConnectField[]>> = {
  FACEBOOK_PAGE: [PAGE_ID, ACCESS_TOKEN],
  INSTAGRAM: [PAGE_ID, ACCESS_TOKEN],
  META_ADS: [
    { name: 'adAccountId', label: 'Ad account ID', kind: 'text', max: 40, help: 'Usually written act_123456789.' },
    { ...PAGE_ID, label: 'Facebook Page ID (the ads run as this Page)' },
    ACCESS_TOKEN,
  ],
  GOOGLE_BUSINESS: [
    { name: 'accountId', label: 'Business Profile account ID', kind: 'digits', max: 30 },
    { name: 'locationId', label: 'Location ID', kind: 'digits', max: 30 },
    ...GOOGLE_OAUTH,
  ],
  GOOGLE_MERCHANT: [
    { name: 'merchantId', label: 'Merchant Center ID', kind: 'digits', max: 30 },
    ...GOOGLE_OAUTH,
  ],
  PINTEREST: [
    { name: 'boardId', label: 'Board ID', kind: 'digits', max: 30, help: 'The board the pins go to (the number in the board link, or from the Pinterest app).' },
    { ...ACCESS_TOKEN, label: 'Pinterest access token', help: 'It is checked with Pinterest, saved encrypted, and never shown again.' },
  ],
  TELEGRAM: [
    { name: 'channel', label: 'Channel (@username or chat ID)', kind: 'text', max: 100, help: 'Add the bot to the channel as an administrator first.' },
    { name: 'botToken', label: 'Bot token (from @BotFather)', kind: 'secret', max: 200 },
  ],
  X: [{ ...ACCESS_TOKEN, label: 'X user access token', help: 'OAuth 2.0 user token. X tokens expire after about 2 hours, so this needs reconnecting until a refresh is added.' }],
  YOUTUBE: [...GOOGLE_OAUTH],
  TIKTOK: [{ ...ACCESS_TOKEN, label: 'TikTok access token', help: 'Posts go to your TikTok inbox as drafts; you finish them in the app.' }],
  WHATSAPP_CLOUD: [
    { name: 'phoneNumberId', label: 'WhatsApp phone number ID', kind: 'digits', max: 30, help: 'In the Meta developer app: WhatsApp, API Setup. It is not the phone number itself.' },
    { ...ACCESS_TOKEN, label: 'Permanent access token', help: 'From a system user with whatsapp_business_messaging. It is checked with Meta, saved encrypted, and never shown again.' },
  ],
  SMS: [
    { name: 'accountSid', label: 'Twilio account ID (starts with AC)', kind: 'text', max: 40 },
    { name: 'from', label: 'Sender (your Twilio number, sender name or Messaging Service ID)', kind: 'text', max: 40, help: 'A number such as +12025550123, a sender name of up to 11 letters (check Zimbabwe allows it), or an ID starting MG.' },
    { name: 'authToken', label: 'Twilio auth token', kind: 'secret', max: 100, help: 'It is checked with Twilio, saved encrypted, and never shown again.' },
  ],
  EMAIL: [
    { name: 'senderEmail', label: 'Sender email address (verified in Brevo)', kind: 'text', max: 200 },
    { name: 'apiKey', label: 'Brevo API key', kind: 'secret', max: 300, help: 'It is checked with Brevo, saved encrypted, and never shown again.' },
  ],
  THREADS: [{ ...ACCESS_TOKEN, label: 'Threads access token', help: 'It is checked with Threads, saved encrypted, and never shown again. The Threads profile ID is read from it.' }],
}

/** Plain message for the first bad value, or null. Pure: the page checks before sending and the API checks again. */
export function connectFieldsError(fields: readonly ConnectField[], values: Record<string, string | undefined>): string | null {
  for (const f of fields) {
    const v = (values[f.name] ?? '').trim()
    if (v === '') return `Fill in: ${f.label}.`
    if (/\s/.test(v)) return `${f.label} must not contain spaces.`
    if (f.kind === 'digits' && !/^\d{5,30}$/.test(v)) return `${f.label} is a number (digits only).`
    if (f.max && v.length > f.max) return `${f.label} is too long.`
  }
  return null
}

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
  /** The boxes of the Connect form (and the body the connect API accepts), in order. Plain data so the page can render them. */
  connectFields: readonly ConnectField[]
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
    connectFields: [],
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
const WITH_CONNECTOR = new Set(['FACEBOOK_PAGE', 'INSTAGRAM', 'META_ADS', 'PINTEREST', 'TELEGRAM', 'X', 'YOUTUBE', 'TIKTOK', 'THREADS', 'GOOGLE_BUSINESS', 'GOOGLE_MERCHANT', 'WHATSAPP_CLOUD', 'SMS', 'EMAIL'])

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
    { publish: true }, { maxText: 500, maxHashtags: 1, imageFormat: 'jpeg', maxImages: 1 },
    ['Make sure the VYRA Instagram account has a Threads profile (open Threads and sign in with Instagram).', 'In Meta for Developers create an app, add the "Access the Threads API" use case, and add the VYRA profile as a Threads tester (App roles, Roles). Accept the invitation in the Threads app (Settings, Account, Website permissions, Invites).', 'In the app, Use cases, Threads API, generate a user token with threads_basic and threads_content_publish. Exchange it for a long-lived token (valid 60 days) as the Meta guide shows.', 'Paste the token into the Connect box. The hub checks it with Threads and reads the profile from it.', 'Turn on live posting in the settings only when you are ready: nothing goes out until you switch it on and approve each post.'],
    ['Text posts are limited to 500 characters; one photo per post here (no carousels yet). Links count as text, at most 5 per post.', 'No scheduling through the API: the hub holds the post until it is due.', 'Long-lived tokens last 60 days and must be renewed; when Threads rejects the token the post fails and you connect again.', 'Until Meta approves the app, only profiles with a role on the app can post.']),
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
    ['Read the warning in the hub guide first: moving your number onto the Cloud API changes how the WhatsApp Business app works on it.', 'Create a Meta business, add the WhatsApp product to a developer app, and add a phone number (a number that is new to WhatsApp, or your shop number with "coexistence").', 'In WhatsApp Manager write your message template (category Marketing) and wait for Meta to approve it. Note its exact name and language.', 'Make a system user with whatsapp_business_messaging and whatsapp_business_management, and generate a permanent token. Copy the phone number ID from API Setup.', 'Paste the phone number ID and the token into the Connect box. Only people who opted in on WhatsApp are ever messaged, and only after you approve each message.'],
    ['Customers must have opted in to WhatsApp messages from you; the hub only messages contacts with a recorded WhatsApp opt-in that has not been withdrawn.', 'Marketing messages outside the 24-hour reply window must be approved templates: the hub never sends free text. Meta charges per marketing template message delivered, so check the price list for Zimbabwe numbers before a big send.', 'Coexistence: the shop number can stay in the WhatsApp Business app, but broadcast lists become read-only there, and chats you have in the app keep working. Check Meta\'s current coexistence rules before moving the number.', 'The Cloud API has no Status, Channels or broadcast list posting: those stay manual.', 'Meta may decline to deliver some marketing messages (error 131049) to protect people from too many promotions.']),
  def('GOOGLE_BUSINESS', 'Google Business Profile', 'google', 'api', ['POST'],
    { publish: true }, { maxText: 1500, maxHashtags: 0, imageFormat: 'jpeg', maxImages: 1 },
    ['Claim and verify the VYRA listing at business.google.com.', 'In Google Cloud create a project, then ask Google for access to the Business Profile APIs (the "GBP API access" request form). Google has to approve the project before any call works; this can take days.', 'Once approved, enable the Business Profile APIs, set up the OAuth consent screen, and create an OAuth client ID (type "Web application") with the https://www.googleapis.com/auth/business.manage scope.', 'Use the OAuth Playground (or your own sign-in) to sign in as the account that owns the listing and copy the refresh token. Find the account ID and the location ID (the numbers in accounts/123/locations/456).', 'Paste the account ID, location ID, client ID, client secret and refresh token into the Connect box. The hub checks them by listing the location.'],
    ['API access needs Google\'s approval of the project, and it can take days. Until then every call is refused.', 'A "What\'s new" post with one photo and a Learn more or Call button. Posts show for 7 days unless they are events or offers. Links in the words are not clickable; the button carries the link.', 'The photo must be a JPEG or PNG of at least 400 x 300 pixels.', 'Insights are not read yet.']),
  def('GOOGLE_MERCHANT', 'Google Merchant Center (free listings)', 'google', 'api', ['POST'],
    { catalog: true }, { maxText: 5000, needsImage: true, maxImages: 10 },
    ['Create a Merchant Center account and verify and claim the VYRA website.', 'In Google Cloud enable the Merchant API and create an OAuth client ID (type "Web application") with the https://www.googleapis.com/auth/content scope.', 'Sign in as a Merchant Center admin (OAuth Playground works) and copy the refresh token. Register the Google Cloud project with Merchant Center (Settings, Developer registration).', 'Paste the Merchant Center ID, client ID, client secret and refresh token into the Connect box. The hub checks them with Google.', 'Turn on "Product feed" in the hub settings, then press "Send products to Google" on this channel (needs live posting on). The hub either registers your feed link as a data source or sends the products one by one.'],
    ['The old Content API ended on 18 August 2026: the hub uses the Merchant API.', 'This channel carries your product catalogue, not posts: it cannot publish a post.', 'Google needs a price on every product; pieces with a hidden price are skipped.', 'Products appear only after Google reviews them, which can take days.']),
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
    ['Create a free Brevo account (brevo.com) and verify the email address or domain VYRA sends from (Senders, Domains and dedicated IPs).', 'Create an API key (SMTP and API, API keys) and copy it.', 'Paste the verified sender address and the API key into the Connect box.', 'Only people who opted in to email are ever emailed, and only after you approve each message.'],
    ['Brevo\'s free plan has a daily sending limit and shows Brevo branding; check the current limits.', 'Every email carries an unsubscribe link and List-Unsubscribe headers. Add your shop address to the words of the email if the law where your customers live asks for it.', 'The sender address must be verified in Brevo or the email is refused.']),
  def('SMS', 'Text messages (SMS)', 'messages', 'api', ['SMS'],
    { publish: true, messages: true }, { maxText: 320, maxHashtags: 0, maxImages: 0 },
    ['Create a Twilio account (twilio.com) and add credit.', 'Buy a sender number, or set up a sender name, that can text Zimbabwe (see the notes below).', 'Copy the account ID (starts AC) and the auth token from the Twilio console.', 'Paste the account ID, the sender and the token into the Connect box.', 'Only people who opted in to SMS are ever texted, and only after you approve each message.'],
    ['Each message costs money. Zimbabwe sender IDs and pricing need checking with Twilio before you rely on them: some countries need a registered sender name, and prices per message differ by network.', 'Every text ends with "Reply STOP to opt out.". If Twilio reports a STOP reply the hub records the person as opted out.', 'A text over 160 characters is sent as several parts and costs more.']),
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
].map((c) => ({ ...c, connector: WITH_CONNECTOR.has(c.kind), connectFields: CONNECT_FIELDS[c.kind] ?? [] }))

const BY_KIND = new Map(CHANNELS.map((c) => [c.kind, c]))

export const CHANNEL_KINDS: readonly string[] = CHANNELS.map((c) => c.kind)

export function getChannel(kind: string): ChannelDef | undefined {
  return BY_KIND.get(kind)
}

export function isChannelKind(kind: unknown): kind is string {
  return typeof kind === 'string' && BY_KIND.has(kind)
}

export const CHANNEL_STATUSES = ['NOT_CONNECTED', 'CONNECTED', 'ERROR', 'MANUAL'] as const
