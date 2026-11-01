"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { loadFeedAction, type FeedActionResult } from "@/lib/storefront/feed-actions";
import {
  detailsPreferenceValue,
  FEED_DETAILS_STORAGE_KEY,
  FEED_TAB_PARAM,
  feedLocation,
  parseDetailsPreference,
  parseLookHash,
  resolveFeedTab,
  slideIndexAt,
  type FeedItem,
  type FeedTab,
} from "@/lib/storefront/feed";
import { Wordmark } from "../Brand";
import { cn } from "../cn";
import { ShellMenuDialog } from "../ShellMenu";
import type { NavItem, SocialLink } from "../types";
import { CollectionSheet } from "./CollectionSheet";
import { ChevronIcon, MenuLinesIcon } from "./feed-icons";
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
  links: { visit: string };
  hasWhatsApp: boolean;
  menu: { nav: NavItem[]; whatsappHref: string | null; social: SocialLink[]; current: string };
};

type Mode = "replace" | "append";
/** A load's outcome: the result, "stale" (a newer request won) or "failed". */
type LoadOutcome = FeedActionResult | "stale" | "failed";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** After a deploy the old page's action id is unknown to the server: only a reload helps. */
function isStaleDeployment(error: unknown): boolean {
  return error instanceof Error && /server action/i.test(error.message);
}

/** replaceState, never throwing (Safari rate-limits history calls). */
function replaceUrl(url: string) {
  try {
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", url);
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
}: FlipFeedProps) {
  /** The tab of the items on screen (changes only together with them). */
  const [tab, setTab] = useState(initialTab);
  const [items, setItems] = useState(initialItems);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [total, setTotal] = useState(initialTotal);
  const [active, setActive] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Caption and rail shown. Clean view (photos only) by default; the choice is kept for the session. */
  const [details, setDetails] = useState(false);

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
  const urlTab = resolveFeedTab(searchParams.get(FEED_TAB_PARAM), tabs);

  const scroller = useRef<HTMLDivElement>(null);
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
    if (el.scrollTop > 40) setHinted(true);
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

  /** Show another tab. On failure, fall back to a full page load of that tab. */
  const switchTab = useCallback(
    async (id: string, slug: string | null) => {
      const outcome = await load({ tab: id, offset: 0, through: slug }, "replace", slug);
      if (outcome === "stale") return;
      const url = feedLocation(window.location.pathname, window.location.search, id, slug);
      if (outcome === "failed") {
        window.location.assign(url);
        return;
      }
      replaceUrl(feedLocation(window.location.pathname, window.location.search, outcome.tab, slug));
    },
    [load],
  );

  const loadMore = useCallback(async () => {
    if (nextOffset === null || busy.current) return;
    const outcome = await load({ tab, offset: nextOffset }, "append");
    if (outcome === "failed") setLoadFailed(true);
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

    const slug = parseLookHash(window.location.hash);
    // Loads and state updates start from a timer, not the effect body.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (urlTab !== initialTab) {
      // Back from a product page after a tab switch: the server rendered the old tab.
      timer = setTimeout(() => void switchTab(urlTab, slug));
    } else if (slug && initialItems.some((p) => p.slug === slug)) {
      // The browser may already have scrolled to #look-<slug> before hydration
      // (no scroll event then): jump anyway and read the slide from scrollTop.
      scrollToIndex(initialItems.findIndex((p) => p.slug === slug), false);
      timer = setTimeout(syncActive);
    } else if (slug && initialNextOffset !== null) {
      timer = setTimeout(() => void load({ tab: initialTab, offset: initialItems.length, through: slug }, "append", slug));
    } else {
      timer = setTimeout(syncActive);
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(detailsTimer);
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

  // ------------------------------------------- scroll: the current slide

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    ready.current = true;
    if (!hinted && el.scrollTop > 40) setHinted(true);
    const index = slideIndexAt(el.scrollTop, el.clientHeight, slideCount);
    if (index !== active) setActive(index);
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

  // ---------------------------------------------------------- actions

  const selectTab = (id: string) => {
    setHinted(true);
    if (id === tab) {
      scrollToIndex(0, true);
      return;
    }
    // The pressed tab changes when its looks arrive (tab and looks never disagree).
    void switchTab(id, null);
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
  const openSheet = () => sheetRef.current?.showModal();
  const onSheetClose = () => pillButton.current?.focus();

  const toggleDetails = () => {
    const next = !details;
    setDetails(next);
    try {
      window.sessionStorage.setItem(FEED_DETAILS_STORAGE_KEY, detailsPreferenceValue(next));
    } catch {
      // Storage blocked (private mode, settings): the choice lasts for this page only.
    }
  };
  const onMenuClose = () => menuButton.current?.focus();

  // ------------------------------------------------------------ render

  const stepButton =
    "sf-focus flex h-12 w-12 items-center justify-center rounded-full border border-brand-ink/20! bg-brand-cream-50 text-brand-ink transition-colors hover:border-brand-ink! disabled:opacity-40 disabled:hover:border-brand-ink/20!";

  return (
    <div className="flex h-full w-full items-center justify-center gap-6 bg-brand-cream">
      {/* Keeps the column centred against the step buttons on computers. */}
      <span aria-hidden="true" className="hidden w-12 md:block" />

      <div className="relative h-full w-full overflow-hidden bg-brand-ink text-brand-cream-50 md:h-[calc(100%-32px)] md:w-auto md:aspect-[9/16] md:max-w-[calc(100vw-160px)] md:rounded-[4px] md:shadow-[0_18px_50px_rgba(30,30,30,0.22)]">
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
              isActive={i === active}
              priority={i === 0 ? "high" : i === 1 ? "eager" : "lazy"}
              details={details}
              onToggleDetails={toggleDetails}
              visitHref={links.visit}
              onLeave={onLeave}
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

        {!hinted && items.length > 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-2.5 z-10 flex flex-col items-center text-brand-cream motion-safe:animate-pulse"
          >
            <ChevronIcon direction="up" className="h-5 w-5" />
            <span className="text-[10px] font-medium uppercase tracking-[0.2em]">Swipe up for the next look</span>
          </div>
        ) : null}
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

      <CollectionSheet
        dialogRef={sheetRef}
        id={sheetId}
        tabs={tabs}
        current={tab}
        onPick={selectTab}
        onClose={onSheetClose}
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
          className="sf-focus flex min-h-[50px] items-center justify-center rounded-[2px] border border-brand-ink! text-[13px] font-medium uppercase tracking-[0.16em] text-brand-ink hover:bg-brand-ink hover:text-brand-cream-50"
        >
          Visit our store
        </Link>
      </div>
    </div>
  );
}
