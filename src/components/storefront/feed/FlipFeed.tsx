"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { track } from "@/lib/analytics/client";
import { loadFeedAction, type FeedActionResult } from "@/lib/storefront/feed-actions";
import {
  detailsPreferenceValue,
  FEED_DETAILS_STORAGE_KEY,
  FEED_NEW_TAB,
  FEED_TAB_PARAM,
  feedLocation,
  lookAnchorId,
  parseDetailsPreference,
  parseLookHash,
  resolveFeedTab,
  slideIndexAt,
  type FeedItem,
  type FeedTab,
} from "@/lib/storefront/feed";
import {
  FEED_GUIDE_PARAM,
  isGuideReplay,
  readGuideSeen,
  shouldOpenGuide,
  withoutGuideParam,
  writeGuideSeen,
} from "@/lib/storefront/feed-guide";
import {
  customHistoryState,
  isOwnSheetEntry,
  landingAction,
  landingSheetHistory,
  sheetCloseMethod,
  sheetCloseReason,
  sheetHistoryState,
  sheetLocation,
  sheetSlugFromSearch,
  type SheetCloseReason,
} from "@/lib/storefront/feed-sheet";
import type { SheetExtras } from "@/lib/storefront/feed-sheet";
import { FEED_DOCUMENT_TITLE, productLandingHistory } from "@/lib/storefront/product-landing";
import { Wordmark } from "../Brand";
import { cn } from "../cn";
import { ShellMenuDialog } from "../ShellMenu";
import type { NavItem, SocialLink } from "../types";
import { CollectionSheet } from "./CollectionSheet";
import { DetailsSheet } from "./DetailsSheet";
import { ChevronIcon, MenuLinesIcon } from "./feed-icons";
import { FeedGuide } from "./FeedGuide";
import { FeedSlide } from "./FeedSlide";

/** Start loading the next page this many slides before the end. */
const LOAD_AHEAD = 3;
/**
 * The URL (#look-<slug>) is written this long after the slide stops
 * changing, not for every slide crossed: Safari throws a SecurityError after
 * 100 history calls in 10 seconds.
 */
const URL_WRITE_DELAY_MS = 250;

export type FlipFeedProps = {
  tabs: FeedTab[];
  initialTab: string;
  initialItems: FeedItem[];
  initialNextOffset: number | null;
  initialTotal: number;
  /** /visit, (ZP-510) tel: of the shop's phone for Call or null, and (ZP-512) the feed's home path on this host. */
  links: { visit: string; call: string | null; home: string };
  hasWhatsApp: boolean;
  menu: { nav: NavItem[]; whatsappHref: string | null; social: SocialLink[]; current: string };
  /**
   * ZP-512: this feed is a /p/<slug> page. "product": start on that look
   * with its sheet open, then turn the URL into the feed's (`<home>?d=<slug>`,
   * the feed on that look behind it). "preview": the owner preview of an
   * unpublished piece (just that look, its sheet open, the URL untouched;
   * `extras` from the server, as the action only knows published pieces).
   */
  landing?: { slug: string; mode: "product" | "preview"; extras?: SheetExtras | null };
};

type Mode = "replace" | "append";
/** A load's outcome: the result, "stale" (a newer request won) or "failed". */
type LoadOutcome = FeedActionResult | "stale" | "failed";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** After a deploy the old page's action id is unknown to the server: only a reload helps. */
function isStaleDeployment(error: unknown): boolean {
  return error instanceof Error && /server action/i.test(error.message);
}

/** localStorage, or null where reading it throws (blocked storage, some private modes). */
function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * replaceState, never throwing (Safari rate-limits history calls). Our part
 * of the entry's state is kept (ZP-510: the details sheet's marker), without
 * the Next.js keys, so Next still syncs its router (customHistoryState).
 */
function replaceUrl(url: string) {
  try {
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(customHistoryState(window.history.state), "", url);
    }
  } catch {
    // Rate-limited or blocked: the URL is a convenience; the feed works without it.
  }
}

/**
 * ZP-500: the landing page feed. One look per full-screen slide (vertical
 * scroll snap, one slide per flick), its photos sideways inside the slide.
 * Phones: the whole screen. Computers: the same feed in a centred
 * phone-shaped column on cream, with up/down buttons beside it.
 *
 * State in the URL: the tab in ?c=<slug>, the current slide in
 * #look-<slug> (replaceState, debounced, so browser back from a product page
 * lands on the same look; the first slide has no hash). See
 * docs/storefront/feed.md.
 */
export function FlipFeed({
  tabs,
  initialTab,
  initialItems,
  initialNextOffset,
  initialTotal,
  links,
  hasWhatsApp,
  menu,
  landing,
}: FlipFeedProps) {
  /** The tab of the items on screen (changes only together with them). */
  const [tab, setTab] = useState(initialTab);
  const [items, setItems] = useState(initialItems);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [total, setTotal] = useState(initialTotal);
  const [active, setActive] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Caption and rail shown. Clean view (photos only) by default; the choice is kept for the session. */
  const [details, setDetails] = useState(false);
  /**
   * ZP-509 first-visit guide: "pending" until the browser has been asked
   * (server render and hydration: no guide), then "open" or "done".
   */
  const [guide, setGuide] = useState<"pending" | "open" | "done">("pending");
  /**
   * The current slide has been read from the scroll position at least once.
   * Until then videos load nothing (on a #look- reload the start is not slide 0).
   */
  const [synced, setSynced] = useState(false);

  // A soft navigation back to this page (new server props) starts afresh.
  const [source, setSource] = useState(initialItems);
  if (source !== initialItems) {
    setSource(initialItems);
    setTab(initialTab);
    setItems(initialItems);
    setNextOffset(initialNextOffset);
    setTotal(initialTotal);
    setActive(0);
    setLoadFailed(false);
  }

  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Review: once a /p/<slug> landing's address has become the feed's, the tab
  // title is the feed's too (after the router has applied the page metadata).
  useEffect(() => {
    if (landing?.mode !== "product" || pathname.includes("/p/")) return;
    const timer = setTimeout(() => {
      document.title = FEED_DOCUMENT_TITLE;
    }, 50);
    return () => clearTimeout(timer);
  }, [pathname, searchParams, landing?.mode]);
  const urlTab = resolveFeedTab(searchParams.get(FEED_TAB_PARAM), tabs);
  // ZP-510: the details sheet is open while the URL has ?d=<slug> of a loaded look.
  const urlSheetSlug = sheetSlugFromSearch(searchParams.toString());
  /**
   * Holds the sheet open regardless of the URL: across the landing swap (d
   * removed, then pushed again), so a router update in between never closes
   * and reopens it; and (ZP-512) from the first render of a /p/<slug> page
   * (open in the server HTML too) until its URL carries d, or for an owner
   * preview until it is closed.
   */
  const [heldSheet, setHeldSheet] = useState<{ slug: string; params: ReturnType<typeof useSearchParams> } | null>(() =>
    landing ? { slug: landing.slug, params: searchParams } : null,
  );
  if (heldSheet && searchParams !== heldSheet.params && urlSheetSlug === heldSheet.slug) setHeldSheet(null);
  const sheetSlug = heldSheet?.slug ?? urlSheetSlug;
  const sheetItem = sheetSlug ? (items.find((p) => p.slug === sheetSlug) ?? null) : null;
  const detailsRef = useRef<HTMLDialogElement>(null);
  /** The link that opened the sheet (focus returns there). */
  const sheetOpener = useRef<HTMLElement | null>(null);
  /** The sheet's own control that started a close (null: the browser back button). */
  const pendingClose = useRef<SheetCloseReason | null>(null);
  /** The feed's history entry is right behind the sheet's (close = history.back()). */
  const entryBehind = useRef(false);
  /** The slug the sheet was last shown for (open / close events). */
  const shownSheet = useRef<string | null>(null);
  /** ZP-513: a look the sheet was closed for ("You may also like"); shown once the sheet is closed. */
  const pendingLook = useRef<string | null>(null);
  /** ZP-513: the latest showLook (called from the close effect). */
  const showLookRef = useRef<(slug: string) => void>(() => {});
  /** ZP-512: a /p/<slug> landing's look, until its sheet open is tracked (from: "shared"). */
  const sharedLanding = useRef(landing?.mode === "product" ? landing.slug : null);
  /** Read in timers (settleLanding), so always the latest render's params. */
  const paramsRef = useRef(searchParams);
  useEffect(() => {
    paramsRef.current = searchParams;
  }, [searchParams]);

  /**
   * A landing `?d=<slug>`, once it is known whether the look is loaded
   * (landingAction): push the sheet entry over the feed (back then closes
   * the sheet without leaving the site), keep our own entry, or drop `d` in
   * place. Runs from a timer, after Next.js patched history.
   */
  const settleLanding = useCallback((slug: string, found: boolean, loadable: boolean, productHome: string | null = null) => {
    const action = landingAction({ inItems: found, loadable, ownEntry: isOwnSheetEntry(window.history.state, slug) });
    if (action === "wait") return action;
    const { pathname, search, hash } = window.location;
    try {
      if (action === "keep") {
        entryBehind.current = true;
      } else if (action === "drop") {
        window.history.replaceState(customHistoryState(window.history.state), "", sheetLocation(pathname, search, hash, null));
      } else {
        setHeldSheet({ slug, params: paramsRef.current });
        // ZP-512: a /p/<slug> landing becomes the feed URL on that look, with the sheet entry on top.
        const entries = productHome
          ? productLandingHistory({ homePath: productHome, search, slug })
          : { replace: sheetLocation(pathname, search, hash, null), push: sheetLocation(pathname, search, hash, slug) };
        window.history.replaceState(customHistoryState(window.history.state), "", entries.replace);
        window.history.pushState(sheetHistoryState(slug), "", entries.push);
        entryBehind.current = true;
        // Backstop: the hold ends when the router shows d again (render check above), at the latest now.
        setTimeout(() => setHeldSheet(null), 1500);
      }
    } catch {
      // History blocked or rate-limited: no entry behind, so closing replaces the URL (never history.back()).
      // A /p/<slug> landing keeps its sheet held open (its URL has no d); closing releases it.
      if (!productHome) setHeldSheet(null);
    }
    return action;
  }, []);

  const scroller = useRef<HTMLDivElement>(null);
  /** The feed column (the guide covers it). */
  const frame = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const pillButton = useRef<HTMLButtonElement>(null);
  const sheetId = useId();
  const dialogId = useId();
  const request = useRef(0);
  const busy = useRef(false);
  /** Mirrors `tab` at once (the URL-sync effect compares against it). */
  const tabRef = useRef(initialTab);
  /**
   * URL writes start once the current slide is known (first scroll, or the
   * jump to a remembered slide), so mounting never wipes the #look- hash.
   */
  const ready = useRef(false);
  /** A slide to jump to once the items it needs have rendered. */
  const pending = useRef<{ slug: string | null } | null>(null);
  const mounted = useRef(false);
  /** The ?c= tab last seen, so the URL-sync effect reacts only to changes. */
  const seenUrlTab = useRef(urlTab);

  const slideCount = items.length + 1; // the looks, then the end (or loading) slide
  const tabLabel = tabs.find((t) => t.id === tab)?.label ?? tabs[0]?.label ?? "";
  const atEnd = nextOffset === null && active >= items.length;

  // ------------------------------------------------------------ helpers

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, index) * el.clientHeight, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  }, []);

  /** Read the current slide from the scroll position (also after a jump that fired no scroll event). */
  const syncActive = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setActive(slideIndexAt(el.scrollTop, el.clientHeight, el.childElementCount));
    setSynced(true);
    ready.current = true;
  }, []);

  const apply = useCallback((result: FeedActionResult, mode: Mode) => {
    tabRef.current = result.tab;
    setTab(result.tab);
    setTotal(result.total);
    setNextOffset(result.nextOffset);
    setLoadFailed(false);
    setItems((prev) => {
      if (mode === "replace") return result.items;
      const seen = new Set(prev.map((p) => p.slug));
      return [...prev, ...result.items.filter((p) => !seen.has(p.slug))];
    });
  }, []);

  /**
   * Fetch a page (server action). `scrollTo`: after it renders, jump to that
   * slug (null, or a slug not in the result: the first slide of the result).
   */
  const load = useCallback(
    async (args: { tab: string; offset: number; through?: string | null }, mode: Mode, scrollTo?: string | null): Promise<LoadOutcome> => {
      const id = ++request.current;
      busy.current = true;
      try {
        const result = await loadFeedAction(args);
        if (id !== request.current) return "stale";
        if (scrollTo !== undefined) pending.current = { slug: scrollTo };
        apply(result, mode);
        return result;
      } catch (error) {
        if (id !== request.current) return "stale";
        if (isStaleDeployment(error)) window.location.reload();
        return "failed";
      } finally {
        if (id === request.current) busy.current = false;
      }
    },
    [apply],
  );

  /** Show another tab. On failure, fall back to a full page load of that tab. The result when the looks arrived, else null. */
  const switchTab = useCallback(
    async (id: string, slug: string | null): Promise<FeedActionResult | null> => {
      const outcome = await load({ tab: id, offset: 0, through: slug }, "replace", slug);
      if (outcome === "stale") return null;
      const url = feedLocation(window.location.pathname, window.location.search, id, slug);
      if (outcome === "failed") {
        track("action_failed", { action: "collection_switch" });
        window.location.assign(url);
        return null;
      }
      replaceUrl(feedLocation(window.location.pathname, window.location.search, outcome.tab, slug));
      return outcome;
    },
    [load],
  );

  const loadMore = useCallback(async () => {
    if (nextOffset === null || busy.current) return;
    const outcome = await load({ tab, offset: nextOffset }, "append");
    if (outcome === "failed") {
      setLoadFailed(true);
      track("action_failed", { action: "feed_load" });
    } else if (outcome !== "stale") {
      track("feed_load_more", { collection: tab, loaded: Math.min(10_000, nextOffset + outcome.items.length) });
    }
  }, [load, nextOffset, tab]);

  // Jump to a pending slide once the items it needs are in the DOM.
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    const index = target.slug ? items.findIndex((p) => p.slug === target.slug) : 0;
    scrollToIndex(Math.max(0, index), false);
    const timer = setTimeout(syncActive);
    return () => clearTimeout(timer);
  }, [items, scrollToIndex, syncActive]);

  // New server props (see `source`): back to the first slide.
  useLayoutEffect(() => {
    if (!mounted.current) return;
    tabRef.current = initialTab;
    scrollToIndex(0, false);
    const timer = setTimeout(syncActive);
    return () => clearTimeout(timer);
    // Only when the server props change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // ----------------------------------------------------- mount: restore

  useEffect(() => {
    mounted.current = true;
    // The feed scrolls inside itself; the document must not (on iOS a
    // document scroll would collapse the URL bar and resize the page).
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";

    // Computers: arrow keys work at once.
    if (window.matchMedia("(min-width: 768px) and (pointer: fine)").matches) {
      scroller.current?.focus({ preventScroll: true });
    }

    // The visitor's "Show details" choice from earlier in this session.
    let storedDetails = false;
    try {
      storedDetails = parseDetailsPreference(window.sessionStorage.getItem(FEED_DETAILS_STORAGE_KEY));
    } catch {
      // Storage blocked: clean view.
    }
    const detailsTimer = storedDetails ? setTimeout(() => setDetails(true)) : undefined;

    // ZP-509: the first-visit guide, over the first look ("seen" in
    // localStorage; never on a #look- hash, never over the details sheet). A replay (?guide=1) is the effect below.
    const decideGuide = () => {
      const open =
        initialItems.length > 0 &&
        shouldOpenGuide({ seen: readGuideSeen(localStore()), hash: window.location.hash, replay: false });
      setGuide(open ? "open" : "done");
      if (open) track("guide_shown");
    };

    // ZP-510: opened with ?d=<slug> (a shared link, a reload, back from the
    // full page). The history work runs from timers, after Next.js has patched
    // history (its effect runs after this child effect), so our entries carry
    // its state. See settleLanding.
    // ZP-512: a /p/<slug> page lands like ?d=<slug> (its look is always in the
    // first load); an owner preview writes no history at all.
    const { search, hash } = window.location;
    const productHome = landing?.mode === "product" ? links.home : null;
    const landingSlug =
      landing?.mode === "product"
        ? landing.slug
        : landing?.mode === "preview"
          ? null
          : (landingSheetHistory(window.location.pathname, search, hash)?.slug ?? null);
    const landingFirst = landing
      ? "push"
      : landingSlug
      ? landingAction({
          inItems: urlTab === initialTab && initialItems.some((p) => p.slug === landingSlug),
          loadable: initialNextOffset !== null || urlTab !== initialTab,
          ownEntry: false,
        })
      : null;
    // The guide never covers a sheet that opens (or may open after a load); a dropped d does not count.
    const guideTimer = isGuideReplay(search)
      ? undefined
      : setTimeout(() => {
          if (landingFirst === "push" || landingFirst === "wait") setGuide("done");
          else decideGuide();
        });
    const settle = (found: boolean, loadable: boolean) => {
      if (!landingSlug) return;
      const action = settleLanding(landingSlug, found, loadable, productHome);
      if (action === "drop" && landingFirst === "wait" && !isGuideReplay(window.location.search)) decideGuide();
    };

    // The look to start on: the /p/<slug> look, else #look-<slug>, else the details sheet's look.
    const slug = landing?.slug ?? parseLookHash(hash) ?? landingSlug;
    const has = (result: FeedActionResult | null | "stale" | "failed") =>
      typeof result === "object" && result !== null && landingSlug !== null && result.items.some((p) => p.slug === landingSlug);
    // Loads and state updates start from a timer, not the effect body.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (urlTab !== initialTab) {
      // Back from a product page after a tab switch: the server rendered the old tab.
      timer = setTimeout(() => void switchTab(urlTab, slug).then((result) => settle(has(result), false)));
    } else if (slug && initialItems.some((p) => p.slug === slug)) {
      // The browser may already have scrolled to #look-<slug> before hydration
      // (no scroll event then): jump anyway and read the slide from scrollTop.
      scrollToIndex(initialItems.findIndex((p) => p.slug === slug), false);
      timer = setTimeout(() => {
        syncActive();
        // No load follows here: a landing look that is not loaded now is dropped.
        settle(landingFirst === "push", false);
      });
    } else if (slug && initialNextOffset !== null) {
      timer = setTimeout(
        () =>
          void load({ tab: initialTab, offset: initialItems.length, through: slug }, "append", slug).then((result) =>
            settle(landingFirst === "push" || has(result), false),
          ),
      );
    } else {
      timer = setTimeout(() => {
        syncActive();
        settle(landingFirst === "push", false);
      });
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(detailsTimer);
      clearTimeout(guideTimer);
      html.style.overflow = previous;
    };
    // Mount only: the initial props describe the server render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The tab in the URL changed under us (a soft navigation to /?c=...): follow it.
  useEffect(() => {
    if (urlTab === seenUrlTab.current) return;
    seenUrlTab.current = urlTab;
    if (urlTab === tabRef.current) return;
    const timer = setTimeout(() => void switchTab(urlTab, null));
    return () => clearTimeout(timer);
  }, [urlTab, switchTab]);

  // ZP-509 replay: /?guide=1 (the menu's "How to use VYRA", also as a soft
  // navigation while on the page) opens the guide over the first look even
  // if seen, and the parameter is removed from the URL. Not on a #look- hash.
  const guideParam = searchParams.get(FEED_GUIDE_PARAM);
  useEffect(() => {
    if (guideParam !== "1") return;
    const open = items.length > 0 && shouldOpenGuide({ seen: true, hash: window.location.hash, replay: true });
    if (open) scrollToIndex(0, false);
    const timer = setTimeout(() => {
      if (open) {
        // Never stacked over the menu or the collections sheet ("How to use VYRA" is a menu row).
        dialogRef.current?.close();
        sheetRef.current?.close();
        syncActive();
        setGuide("open");
        track("guide_replayed");
      } else {
        setGuide((g) => (g === "pending" ? "done" : g));
      }
      // Last: removing the parameter changes `guideParam` (this effect then does nothing).
      replaceUrl(withoutGuideParam(window.location.pathname, window.location.search, window.location.hash));
    });
    return () => clearTimeout(timer);
  }, [guideParam, items.length, scrollToIndex, syncActive]);

  const onGuideDone = useCallback(() => {
    writeGuideSeen(localStore());
    setGuide("done");
  }, []);

  /** The eye button of the look on screen (the guide's third step rings it). */
  const findEye = useCallback(() => {
    const el = scroller.current;
    if (!el) return null;
    const index = slideIndexAt(el.scrollTop, el.clientHeight, el.childElementCount);
    return el.querySelector(`[data-feed-slide="${index}"] [data-feed-eye]`);
  }, []);

  const focusFeed = useCallback(() => scroller.current?.focus({ preventScroll: true }), []);

  // ------------------------------------------- scroll: the current slide

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    ready.current = true;
    const index = slideIndexAt(el.scrollTop, el.clientHeight, slideCount);
    if (index !== active) setActive(index);
    if (!synced) setSynced(true);
    if (!loadFailed && index >= items.length - LOAD_AHEAD) void loadMore();
  };

  // Write #look-<slug> once the slide settles (debounced, never throws).
  useEffect(() => {
    if (!ready.current) return;
    const item = items[Math.min(active, items.length - 1)];
    const slug = active > 0 && item ? item.slug : null;
    const timer = setTimeout(() => {
      replaceUrl(feedLocation(window.location.pathname, window.location.search, tab, slug));
    }, URL_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, items, tab]);

  // ZP-493: the end slide of a collection reached (once per collection per page load).
  const endsReached = useRef(new Set<string>());
  useEffect(() => {
    if (!atEnd || items.length === 0 || endsReached.current.has(tab)) return;
    endsReached.current.add(tab);
    track("feed_end_reached", { collection: tab, looks: Math.min(10_000, items.length) });
  }, [atEnd, items.length, tab]);

  // ---------------------------------------------------------- actions

  const selectTab = (id: string) => {
    if (id === tab) {
      scrollToIndex(0, true);
      return;
    }
    // The pressed tab changes when its looks arrive (tab and looks never disagree).
    const from = tab;
    void switchTab(id, null).then((ok) => {
      if (ok) track("collection_switch", { from, to: id });
    });
  };

  const retryLoadMore = () => {
    setLoadFailed(false);
    void loadMore();
  };

  const step = (dir: 1 | -1) => scrollToIndex(Math.min(slideCount - 1, Math.max(0, active + dir)), true);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const onFeed = event.target === event.currentTarget;
    switch (event.key) {
      case "ArrowDown":
      case "PageDown":
        step(1);
        break;
      case "ArrowUp":
      case "PageUp":
        step(-1);
        break;
      case " ":
        if (!onFeed) return; // Space on a button presses it
        step(event.shiftKey ? -1 : 1);
        break;
      case "Home":
        scrollToIndex(0, true);
        break;
      case "End":
        scrollToIndex(slideCount - 1, true);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  /** Leaving for a product page: write this slide into the URL now. */
  const onLeave = (slug: string) =>
    replaceUrl(feedLocation(window.location.pathname, window.location.search, tab, items[0]?.slug === slug ? null : slug));

  const backToStart = () => {
    scrollToIndex(0, true);
    scroller.current?.focus({ preventScroll: true });
  };

  const openMenu = () => dialogRef.current?.showModal();
  const openSheet = () => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.showModal();
    // Focus starts on the current collection.
    sheet.querySelector<HTMLButtonElement>("[aria-current=\"true\"]")?.focus();
  };
  const onSheetClose = () => pillButton.current?.focus();

  const toggleDetails = () => {
    const next = !details;
    setDetails(next);
    const look = items[active];
    if (look) track(next ? "details_show" : "details_hide", { slug: look.slug, collection: tab });
    try {
      window.sessionStorage.setItem(FEED_DETAILS_STORAGE_KEY, detailsPreferenceValue(next));
    } catch {
      // Storage blocked (private mode, settings): the choice lasts for this page only.
    }
  };
  const onMenuClose = () => menuButton.current?.focus();

  // --------------------------------------------- ZP-510: details sheet

  /** Details, the caption or the photo: push `?d=<slug>` (the URL drives the sheet; the feed does not move). */
  const openDetails = useCallback(
    (slug: string, opener: HTMLElement) => {
      sheetOpener.current = opener;
      pendingClose.current = null;
      const { pathname, search, hash } = window.location;
      try {
        window.history.pushState(sheetHistoryState(slug), "", sheetLocation(pathname, search, hash, slug));
        entryBehind.current = true;
      } catch {
        // History blocked or rate-limited: fall back to the full page.
        const item = items.find((p) => p.slug === slug);
        if (item) window.location.assign(item.href);
      }
    },
    [items],
  );

  /** A close from the sheet's own controls: pop our history entry (or drop `d` in place). */
  const requestCloseDetails = useCallback((reason: SheetCloseReason) => {
    if (pendingClose.current) return; // already closing
    pendingClose.current = reason;
    detailsRef.current?.close(); // at once; the URL follows
    setHeldSheet(null); // an owner preview's (or an unsettled /p/<slug> landing's) sheet, held without d
    const back = sheetCloseMethod(entryBehind.current) === "back";
    entryBehind.current = false;
    try {
      if (back) window.history.back();
      else {
        const { pathname, search, hash } = window.location;
        window.history.replaceState(customHistoryState(window.history.state), "", sheetLocation(pathname, search, hash, null));
      }
    } catch {
      // Ignore: the sheet is closed; the URL keeps d until the next write.
    }
  }, []);

  // Open / close events, focus return, and the browser back button (d left the URL with no pending reason).
  const sheetShownSlug = sheetItem?.slug ?? null;
  useEffect(() => {
    const previous = shownSheet.current;
    if (previous === sheetShownSlug) return;
    shownSheet.current = sheetShownSlug;
    if (previous) {
      track("details_sheet_close", { slug: previous, collection: tabRef.current, reason: sheetCloseReason(pendingClose.current) });
      pendingClose.current = null;
    }
    if (sheetShownSlug) {
      // Opened by the forward button: only our own entry (marker) has the feed entry behind it.
      if (!entryBehind.current && isOwnSheetEntry(window.history.state, sheetShownSlug)) entryBehind.current = true;
      // ZP-512: the first open of a /p/<slug> landing is a shared link's.
      const shared = sharedLanding.current === sheetShownSlug;
      sharedLanding.current = null;
      track("details_sheet_open", { slug: sheetShownSlug, collection: tabRef.current, ...(shared ? { from: "shared" } : {}) });
    } else {
      entryBehind.current = false;
      const opener = sheetOpener.current;
      sheetOpener.current = null;
      // ZP-513: closed for a "You may also like" piece: go to its look (after the URL lost d).
      const look = pendingLook.current;
      pendingLook.current = null;
      if (look) showLookRef.current(look);
      else if (opener?.isConnected) opener.focus({ preventScroll: true });
      else scroller.current?.focus({ preventScroll: true });
    }
  }, [sheetShownSlug]);

  // ------------------------------------------- ZP-513: "You may also like"

  /** Focus a slide (once it is the one on screen) without scrolling. */
  const focusSlide = useCallback((slug: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`#${CSS.escape(lookAnchorId(slug))}`);
    el?.focus({ preventScroll: true });
  }, []);

  /**
   * Take the shopper to a look, full screen on its first photo: a smooth
   * scroll when it is loaded in this collection; else switch to New in (or
   * load further in New in) through it, like the #look- restore. The URL
   * then follows the slide (#look-<slug>, debounced), and focus moves to it.
   */
  const showLook = useCallback(
    (slug: string) => {
      const index = items.findIndex((p) => p.slug === slug);
      if (index >= 0) {
        scrollToIndex(index, true);
        setTimeout(() => focusSlide(slug), reducedMotion() ? 0 : 450);
        return;
      }
      // Review: New in loads on from where the feed stopped (nextOffset), not from the item count.
      if (tabRef.current === FEED_NEW_TAB && nextOffset === null) return;
      const loaded =
        tabRef.current !== FEED_NEW_TAB
          ? switchTab(FEED_NEW_TAB, slug)
          : load({ tab: FEED_NEW_TAB, offset: nextOffset as number, through: slug }, "append", slug);
      void loaded.then(() => setTimeout(() => focusSlide(slug), 50));
    },
    [items, nextOffset, scrollToIndex, focusSlide, switchTab, load],
  );
  useEffect(() => {
    showLookRef.current = showLook;
  }, [showLook]);

  /** The sheet's "You may also like" tap: track it, close the sheet, then show that look. */
  const goToLook = useCallback(
    (from: string, to: string) => {
      track("also_like_open", { slug: from, collection: tabRef.current, to });
      pendingLook.current = to;
      requestCloseDetails("also_like");
    },
    [requestCloseDetails],
  );

  // ------------------------------------------------------------ render

  const stepButton =
    "sf-focus flex h-12 w-12 items-center justify-center rounded-full border border-brand-ink/20! bg-brand-cream-50 text-brand-ink transition-colors hover:border-brand-ink! disabled:opacity-40 disabled:hover:border-brand-ink/20!";

  return (
    // FEED_PAGE_ATTR: the storefront frame becomes the full-screen feed frame for any page that renders this.
    <div data-feed-page="" className="flex h-full w-full items-center justify-center gap-6 bg-brand-cream">
      {/* Keeps the column centred against the step buttons on computers. */}
      <span aria-hidden="true" className="hidden w-12 md:block" />

      <div ref={frame} className="relative h-full w-full overflow-hidden bg-brand-ink text-brand-cream-50 md:h-[calc(100%-32px)] md:w-auto md:aspect-[9/16] md:max-w-[calc(100vw-160px)] md:rounded-[4px] md:shadow-[0_18px_50px_rgba(30,30,30,0.22)]">
        {/* Slim top bar, first in reading and tab order, drawn on top: menu, wordmark, collection pill. Ink over the cream end slide. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 pt-3.5",
            atEnd && "text-brand-ink",
          )}
        >
          <button
            ref={menuButton}
            type="button"
            onClick={openMenu}
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-controls={dialogId}
            className="sf-focus pointer-events-auto flex h-11 w-11 items-center justify-center rounded-[2px]"
          >
            <MenuLinesIcon className="h-6 w-6" />
          </button>
          <h1 className="m-0 flex items-center">
            <Wordmark className="h-[18px] w-auto" title="VYRA – Wear Different." />
          </h1>
          {tabs.length > 1 ? (
            <button
              ref={pillButton}
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              aria-controls={sheetId}
              aria-label={`Collection: ${tabLabel}. Change collection`}
              className={cn(
                "sf-focus pointer-events-auto flex min-h-9 max-w-[128px] items-center gap-1 justify-self-end rounded-full border pl-3 pr-2.5 text-[11px] font-medium uppercase tracking-[0.12em]",
                atEnd ? "border-brand-ink/45! bg-brand-cream-50/60" : "border-brand-cream-50/45! bg-[rgba(20,20,18,0.4)] [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]",
              )}
            >
              <span className="truncate">{tabLabel}</span>
              <ChevronIcon direction="down" className="h-3.5 w-3.5 shrink-0" />
            </button>
          ) : null}
        </div>

        <div
          ref={scroller}
          tabIndex={0}
          role="region"
          aria-label="Looks. Use the up and down arrow keys to move between looks."
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          className="sf-focus absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none [scrollbar-width:none] focus-visible:outline-offset-[-4px] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item, i) => (
            <FeedSlide
              // Per collection: switching collection starts every look on its first photo.
              key={`${tab}:${item.slug}`}
              item={item}
              index={i}
              total={total}
              priority={i === 0 ? "high" : i === 1 ? "eager" : "lazy"}
              // Null until the current slide is read from the scroll position (a #look- reload starts elsewhere).
              slideOffset={synced ? i - active : null}
              details={details}
              onToggleDetails={toggleDetails}
              visitHref={links.visit}
              onLeave={onLeave}
              collection={tab}
              callHref={links.call}
              onOpenDetails={openDetails}
              sheetOpen={sheetItem?.slug === item.slug}
              preview={landing?.mode === "preview"}
            />
          ))}
          {nextOffset === null ? (
            <FeedEnd
              empty={items.length === 0}
              tabLabel={tabLabel}
              hasWhatsApp={hasWhatsApp}
              visitHref={links.visit}
              onBackToStart={backToStart}
            />
          ) : (
            <div
              role="group"
              aria-label="More looks"
              className="flex h-full snap-start snap-always flex-col items-center justify-center gap-4 bg-[#2a2a26] px-8 text-center"
            >
              {loadFailed ? (
                <>
                  <p className="sf-label text-brand-cream" role="status">
                    We could not load more looks.
                  </p>
                  <button
                    type="button"
                    onClick={retryLoadMore}
                    className="sf-focus min-h-11 rounded-[2px] border border-brand-cream-50/75! px-5 text-xs font-medium uppercase tracking-[0.16em] text-brand-cream-50"
                  >
                    Try again
                  </button>
                </>
              ) : (
                <p className="sf-label text-brand-cream" role="status">
                  Loading more looks…
                </p>
              )}
            </div>
          )}
        </div>

      </div>

      <div className="hidden w-12 flex-col gap-3 md:flex">
        <button type="button" onClick={() => step(-1)} disabled={active === 0} aria-label="Previous look" className={stepButton}>
          <ChevronIcon direction="up" className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={active >= slideCount - 1}
          aria-label="Next look"
          className={stepButton}
        >
          <ChevronIcon direction="down" className="h-5 w-5" />
        </button>
      </div>

      {guide === "open" ? (
        <FeedGuide frameRef={frame} findEye={findEye} onDone={onGuideDone} fallbackFocus={focusFeed} />
      ) : null}

      <CollectionSheet
        dialogRef={sheetRef}
        id={sheetId}
        tabs={tabs}
        current={tab}
        onPick={selectTab}
        onClose={onSheetClose}
      />

      <DetailsSheet
        dialogRef={detailsRef}
        item={sheetItem}
        collection={tab}
        links={links}
        onRequestClose={requestCloseDetails}
        seedExtras={landing?.mode === "preview" ? (landing.extras ?? null) : null}
        preview={landing?.mode === "preview"}
        onGoToLook={goToLook}
      />

      <ShellMenuDialog
        dialogRef={dialogRef}
        id={dialogId}
        nav={menu.nav}
        whatsappHref={menu.whatsappHref}
        social={menu.social}
        current={menu.current}
        onClose={onMenuClose}
      />
    </div>
  );
}

/** The cream end slide: every look seen, back to the first, or visit the store. */
function FeedEnd({
  empty,
  tabLabel,
  hasWhatsApp,
  visitHref,
  onBackToStart,
}: {
  empty: boolean;
  tabLabel: string;
  hasWhatsApp: boolean;
  visitHref: string;
  onBackToStart: () => void;
}) {
  return (
    <div
      role="group"
      aria-labelledby="feed-end-title"
      className="flex h-full snap-start snap-always flex-col items-center justify-center gap-5 bg-brand-cream px-8 text-center text-brand-ink"
    >
      <Wordmark className="h-auto w-[150px]" title="" />
      <p className="m-0 text-xs font-medium uppercase tracking-[0.24em] text-brand-olive-700">Wear different.</p>
      <h2 id="feed-end-title" className="m-0 font-serif text-[34px] font-medium leading-[1.1] text-balance">
        {empty ? (
          "New looks are on their way"
        ) : (
          <>
            You have seen every look in <em className="text-brand-olive-700">{tabLabel}</em>
          </>
        )}
      </h2>
      <p className="m-0 text-[15px] leading-relaxed text-brand-ink-soft">
        {hasWhatsApp
          ? "New pieces arrive often. Come and try them on, or ask us on WhatsApp."
          : "New pieces arrive often. Come and try them on."}
      </p>
      <div className="flex w-full max-w-[280px] flex-col gap-2.5">
        {!empty ? (
          <button
            type="button"
            onClick={onBackToStart}
            className="sf-focus min-h-[50px] rounded-[2px] bg-brand-olive text-[13px] font-medium uppercase tracking-[0.16em] text-brand-cream-50 hover:bg-brand-olive-700"
          >
            Back to the first look
          </button>
        ) : null}
        <Link
          href={visitHref}
          onClick={() => track("visit_us", { screen: "feed" })}
          className="sf-focus flex min-h-[50px] items-center justify-center rounded-[2px] border border-brand-ink! text-[13px] font-medium uppercase tracking-[0.16em] text-brand-ink hover:bg-brand-ink hover:text-brand-cream-50"
        >
          Visit our store
        </Link>
      </div>
    </div>
  );
}
