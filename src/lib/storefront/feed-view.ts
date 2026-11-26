// ZP-543 / ZP-544 (view part): which feed view a page shows. Pure; safe on the
// client and the server. Tested in tests/storefront-feed-view.test.ts. See
// docs/storefront/feed.md ("Feed views").
//
// Two views of the landing feed:
//   clean: today's feed (photos only; caption, Share, Details behind the eye).
//   info:  ZP-1018: every look opens on the whole photo (WhatsApp / Call at the
//          right, a "Show details" pill); Show details slides up the panel
//          (availability, name, price, Ask price on WhatsApp, View sizes &
//          details). See "info panel modes" below.
// The owner's setting (SiteSettings.feedView) picks CLEAN, INFO or AB.
//
// Shared contract with the analytics (ZP-544, src/lib/analytics/**):
//  1. The view in effect is <html data-feed-view="clean|info">
//     (document.documentElement.dataset.feedView), set BEFORE first paint by
//     the inline script feedViewScript() (rendered by FeedViewProvider in the
//     storefront layout), so there is no flash of the other view.
//  2. <html data-feed-view-test="1"> only when the view came from the A/B
//     assignment (setting AB, no preview). Absent otherwise.
//  3. Setting values CLEAN (default), INFO, AB.
//  4. A/B: 50/50 random, stored in localStorage `vyra:feed:view-ab`
//     (clean|info), so a browser keeps its view. Storage blocked or not
//     writable: random per page load and not a test visit.
//  5. `?view=clean|info` on any storefront URL forces that view for that page
//     load: never a test visit, never stored.

import { PREORDER_ENQUIRE_LABEL } from '@/lib/storefront-model/preorder'
export const FEED_VIEW_MODES =['CLEAN', 'INFO', 'AB'] as const
/** The owner's setting (Prisma enum FeedView). */
export type FeedViewMode = (typeof FEED_VIEW_MODES)[number]
export const FEED_VIEW_DEFAULT_MODE: FeedViewMode = 'CLEAN'

export const FEED_VIEWS = ['clean', 'info'] as const
/** The view a visitor sees. */
export type FeedView = (typeof FEED_VIEWS)[number]

/** localStorage key of the A/B assignment. */
export const FEED_VIEW_AB_STORAGE_KEY = 'vyra:feed:view-ab'
/** The preview query parameter (`?view=info`). */
export const FEED_VIEW_PARAM = 'view'
/** <html> attributes (dataset.feedView, dataset.feedViewTest). */
export const FEED_VIEW_ATTR = 'data-feed-view'
export const FEED_VIEW_TEST_ATTR = 'data-feed-view-test'

export function isFeedViewMode(value: unknown): value is FeedViewMode {
  return (FEED_VIEW_MODES as readonly unknown[]).includes(value)
}

/** Exactly "clean" or "info", else null. */
export function parseFeedView(raw: unknown): FeedView | null {
  return raw === 'clean' || raw === 'info' ? raw : null
}

/** The preview override from a query value (Next searchParams: the first value of a repeated one). */
export function previewView(raw: string | string[] | null | undefined): FeedView | null {
  return parseFeedView(Array.isArray(raw) ? raw[0] : raw)
}

/** The preview override in a location.search string. */
export function previewFromSearch(search: string): FeedView | null {
  return parseFeedView(new URLSearchParams(search).get(FEED_VIEW_PARAM))
}

/** Without JavaScript: fixed modes show their view; A/B shows clean. */
export function noScriptView(mode: FeedViewMode): FeedView {
  return mode === 'INFO' ? 'info' : 'clean'
}

/**
 * The views the server renders. Known on the server (a fixed mode, or a
 * preview): just that one, so CLEAN renders exactly today's feed. A/B: both,
 * and CSS (globals.css, `.sf-view-*`) shows the one the inline script picked
 * (clean when it did not run).
 */
export function serverViews(mode: FeedViewMode, preview: string | string[] | null | undefined): FeedView[] {
  const forced = previewView(preview)
  if (forced) return [forced]
  return mode === 'AB' ? ['clean', 'info'] : [noScriptView(mode)]
}

type ViewStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void }

export type FeedViewResolution = { view: FeedView; test: boolean }

/**
 * The view for this page load (the inline script does the same; a test keeps
 * the two in step). Preview first, then a fixed mode, then the A/B assignment:
 * the stored one, else a 50/50 pick that is stored. It is a test visit only
 * when the stored assignment is (now) in storage.
 */
export function resolveFeedView(input: {
  mode: FeedViewMode
  preview: FeedView | null
  storage: ViewStorage | null | undefined
  random: () => number
}): FeedViewResolution {
  if (input.preview) return { view: input.preview, test: false }
  if (input.mode !== 'AB') return { view: noScriptView(input.mode), test: false }
  let picked: FeedView | null = null
  try {
    const storage = input.storage
    if (!storage) throw new Error('no storage')
    const stored = parseFeedView(storage.getItem(FEED_VIEW_AB_STORAGE_KEY))
    if (stored) return { view: stored, test: true }
    picked = pick(input.random)
    storage.setItem(FEED_VIEW_AB_STORAGE_KEY, picked)
    return { view: picked, test: storage.getItem(FEED_VIEW_AB_STORAGE_KEY) === picked }
  } catch {
    return { view: picked ?? pick(input.random), test: false }
  }
}

function pick(random: () => number): FeedView {
  return random() < 0.5 ? 'clean' : 'info'
}

/** The view on <html> (dataset.feedView), or null when the script has not set one. */
export function readDatasetView(dataset: { feedView?: string }): FeedView | null {
  return parseFeedView(dataset.feedView)
}

/** Writes a resolution onto <html> the way the inline script does. */
export function applyFeedView(root: Pick<Element, 'setAttribute' | 'removeAttribute'>, r: FeedViewResolution): void {
  root.setAttribute(FEED_VIEW_ATTR, r.view)
  if (r.test) root.setAttribute(FEED_VIEW_TEST_ATTR, '1')
  else root.removeAttribute(FEED_VIEW_TEST_ATTR)
}

/**
 * The inline script (ES5, no imports): resolveFeedView for this page load,
 * written onto <html>. Runs while the HTML is parsed, before first paint.
 * Only the validated mode and constants are baked in (JSON literals), so
 * nothing can close the <script> element.
 */
export function feedViewScript(mode: FeedViewMode): string {
  const m = JSON.stringify(isFeedViewMode(mode) ? mode : FEED_VIEW_DEFAULT_MODE)
  const k = JSON.stringify(FEED_VIEW_AB_STORAGE_KEY)
  const p = JSON.stringify(FEED_VIEW_PARAM)
  return (
    '(function(){' +
    `var d=document.documentElement,m=${m},k=${k},v=null,t=0,` +
    'ok=function(x){return x==="clean"||x==="info"},' +
    'r=function(){return Math.random()<0.5?"clean":"info"};' +
    `try{var q=new URLSearchParams(location.search).get(${p});if(ok(q))v=q}catch(e){}` +
    'if(!v){if(m==="INFO")v="info";else if(m!=="AB")v="clean";else{' +
    'try{var s=localStorage.getItem(k);if(ok(s)){v=s;t=1}else{v=r();localStorage.setItem(k,v);t=localStorage.getItem(k)===v?1:0}}' +
    'catch(e){if(!v)v=r();t=0}}}' +
    `d.setAttribute(${JSON.stringify(FEED_VIEW_ATTR)},v);` +
    `if(t)d.setAttribute(${JSON.stringify(FEED_VIEW_TEST_ATTR)},"1");else d.removeAttribute(${JSON.stringify(FEED_VIEW_TEST_ATTR)})` +
    '})()'
  )
}

// ------------------------------------------------------------ info panel

type InfoItem = {
  soldOut: boolean
  badge: { kind: 'sold-out' | 'few-left' | 'new' | 'pre-order'; label: string } | null
  enquireHref: string | null
  preOrder?: { label: string } | null
}

export type InfoAvailability = { kind: 'in-stock' | 'few-left' | 'sold-out' | 'pre-order'; label: string }

/** The panel's tag, from the slide's existing badge data: Sold out, Few left, else In stock. */
export function infoAvailability(item: Pick<InfoItem, 'soldOut' | 'badge'>): InfoAvailability {
  if (item.soldOut || item.badge?.kind === 'sold-out') return { kind: 'sold-out', label: 'Sold out' }
  if (item.badge?.kind === 'pre-order') return { kind: 'pre-order', label: item.badge.label }
  if (item.badge?.kind === 'few-left') return { kind: 'few-left', label: 'Few left' }
  return { kind: 'in-stock', label: 'In stock' }
}

/** "$65" (the feed's price) as "US$65"; "Ask for price" unchanged. */
export function infoPrice(price: string): string {
  return price.startsWith('$') ? `US${price}` : price
}

export type InfoPrimary = { kind: 'ask' | 'restock' | 'visit' | 'pre-order'; label: string }

/**
 * The panel's main button: the existing enquiry link (restock message when
 * sold out), or Visit us without WhatsApp. ZP-1018: every piece is now "Ask
 * for price", so the button asks for it.
 */
export function infoPrimary(item: Pick<InfoItem, 'soldOut' | 'enquireHref' | 'preOrder'>): InfoPrimary {
  if (item.enquireHref === null) return { kind: 'visit', label: 'Visit us' }
  if (!item.soldOut && item.preOrder) return { kind: 'pre-order', label: PREORDER_ENQUIRE_LABEL }
  return item.soldOut ? { kind: 'restock', label: 'Ask about restock' } : { kind: 'ask', label: 'Ask price on WhatsApp' }
}

export type InfoAction = 'love' | 'share' | 'call'

/** The small round buttons stacked above the panel, top to bottom. No eye in this view. */
export function infoActions(input: { share: boolean; call: boolean; preview?: boolean }): InfoAction[] {
  return [
    ...(input.preview ? [] : (['love'] as const)),
    ...(input.share ? (['share'] as const) : []),
    ...(input.call ? (['call'] as const) : []),
  ]
}

// ------------------------------------------------------ info panel modes
//
// ZP-1018: the info view opens every look on the whole photo, details on demand.
//   photo:   the photo only; WhatsApp (or Visit us) and Call at the right and a
//            "Show details" pill at the bottom centre. How every look opens.
//   details: the panel (above), with Hide details, the heart, share and Call
//            stacked at the right above it (infoActions).
//   slim:    the panel shrunk to one line (name, "Ask for price · tap for
//            more", a round WhatsApp button) after the visitor swiped to
//            another photo of the same look; tapping the line brings it back.
// Each look keeps its own mode (FeedSlide) and starts again in photo mode once
// it has left the screen (another look, a collection switch, "You may also
// like"). Tested in tests/storefront-feed-info-mode.test.ts.

export const INFO_MODES = ['photo', 'details', 'slim'] as const
export type InfoMode = (typeof INFO_MODES)[number]
/** How every look opens. */
export const INFO_MODE_START: InfoMode = 'photo'

/**
 * show: Show details. hide: Hide details. expand: a tap on the slim line.
 * photo-swipe: the visitor's own move to another photo of the same look
 * (isVisitorPhotoChange). leave-look: the look left the screen. tour-start:
 * the first-visit photo tour starts on the look (it runs in photo mode).
 */
export type InfoModeEvent = 'show' | 'hide' | 'expand' | 'photo-swipe' | 'leave-look' | 'tour-start'

export function nextInfoMode(mode: InfoMode, event: InfoModeEvent): InfoMode {
  switch (event) {
    case 'show':
      return 'details'
    case 'hide':
    case 'leave-look':
    case 'tour-start':
      return 'photo'
    case 'expand':
      return mode === 'slim' ? 'details' : mode
    case 'photo-swipe':
      return mode === 'details' ? 'slim' : mode
  }
}

/**
 * The analytics event for a change: the same ones clean view's eye sends. The
 * popularity ranking reads details_show, so in both views it means "the
 * visitor asked to see this look's details": Show details from photo mode;
 * details_hide for Hide details from the panel or the slim line. Nothing else
 * (not the slim line, a reset or the tour).
 */
export function infoModeTrack(mode: InfoMode, event: InfoModeEvent): 'details_show' | 'details_hide' | null {
  if (event === 'show' && mode === 'photo') return 'details_show'
  if (event === 'hide' && mode !== 'photo') return 'details_hide'
  return null
}

/**
 * A move to another photo is the visitor's own (it may shrink the panel)
 * unless the tour is running, or the tour has just ended and its own smooth
 * scroll is still settling (`settleMs`: feed-guide's TOUR_SETTLE_MS, passed
 * in so this module, read by the site settings, stays free of the feed code).
 * The same rule keeps the tour's photos out of photo_view (ZP-516).
 */
export function isVisitorPhotoChange(input: { touring: boolean; afterTour: boolean; sinceTourEndMs: number; settleMs: number }): boolean {
  if (input.touring) return false
  return !input.afterTour || input.sinceTourEndMs > input.settleMs
}

export type InfoPhotoRailItem = 'enquire' | 'visit' | 'call'

/** Photo mode's right-hand buttons, top to bottom: WhatsApp (Visit us without a number), Call with a phone. */
export function infoPhotoRail(input: { enquire: boolean; call: boolean }): InfoPhotoRailItem[] {
  return [input.enquire ? 'enquire' : 'visit', ...(input.call ? (['call'] as const) : [])]
}

/** The slim line's second line: "Ask for price · tap for more". */
export function infoSlimLine(price: string): string {
  return `${infoPrice(price)} · tap for more`
}
