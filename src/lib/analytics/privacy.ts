// ZP-493: who is never collected. Pure; used by the browser tracker and the
// endpoint (both check, so a tracker bug or a hand-made request still obeys).
//
// - Global Privacy Control (Sec-GPC / navigator.globalPrivacyControl) and
//   Do Not Track (DNT / navigator.doNotTrack): no collection at all.
// - Bots: crawlers, link-preview fetchers, HTTP tools, headless and
//   automated browsers. Their requests are answered 204 and dropped.

/**
 * User-agent fragments of crawlers, link previews (WhatsApp, Facebook,
 * Instagram), HTTP libraries, performance tools and headless browsers.
 * Matched case-insensitively. Real in-app browsers (Instagram, Facebook,
 * TikTok) say "Instagram 352.0..." / "FBAN" and are not matched.
 */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|scrap|preview|externalhit|facebookcatalog|whatsapp\/|telegram|discord|skype|headless|phantomjs|selenium|webdriver|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget|httpie|python|java\/|okhttp|go-http-client|node-fetch|undici|axios|libwww|httpclient|postman|insomnia|^mozilla\/5\.0$/i

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim()
  if (ua.length < 10) return true // empty or not a browser
  // CUBOT is an Android phone brand, not a bot. (No regex lookbehind: it is a
  // syntax error in Safari before 16.4, and this module runs in the browser.)
  return BOT_UA.test(ua.replace(/cubot/gi, 'phone'))
}

/** Server side: drop this request? (no or bot user agent, headless client hint). */
export function isBotRequest(headers: Headers): boolean {
  if (isBotUserAgent(headers.get('user-agent'))) return true
  const hints = `${headers.get('sec-ch-ua') ?? ''} ${headers.get('sec-ch-ua-full-version-list') ?? ''}`
  return /headless/i.test(hints)
}

/** Server side: GPC or DNT set. */
export function isOptedOutRequest(headers: Headers): boolean {
  return headers.get('sec-gpc')?.trim() === '1' || headers.get('dnt')?.trim() === '1'
}

export type PrivacyNavigator = {
  userAgent?: string
  globalPrivacyControl?: boolean
  doNotTrack?: string | null
  msDoNotTrack?: string | null
  webdriver?: boolean
}

const DNT_ON = (v: unknown) => v === '1' || v === 'yes' || v === 1 || v === true

/** Browser side: GPC or DNT (navigator.doNotTrack, or window.doNotTrack in old Safari / Edge). */
export function isOptedOutClient(nav: PrivacyNavigator, win: { doNotTrack?: string | null } = {}): boolean {
  return nav.globalPrivacyControl === true || DNT_ON(nav.doNotTrack) || DNT_ON(nav.msDoNotTrack) || DNT_ON(win.doNotTrack)
}

/** Browser side: an automated or headless browser (navigator.webdriver, bot user agent). */
export function isAutomatedClient(nav: PrivacyNavigator): boolean {
  return nav.webdriver === true || isBotUserAgent(nav.userAgent)
}
