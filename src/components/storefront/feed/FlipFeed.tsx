"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { loadFeedAction, type FeedActionResult } from "@/lib/storefront/feed-actions";
import { FEED_TAB_PARAM, feedLocation, parseLookHash, type FeedItem, type FeedTab } from "@/lib/storefront/feed";
import { Wordmark } from "../Brand";
import { cn } from "../cn";
import { ShellMenuDialog } from "../ShellMenu";
import type { NavItem, SocialLink } from "../types";
import { ChevronIcon, MenuLinesIcon, PinIcon } from "./feed-icons";
import { FeedSlide } from "./FeedSlide";

/** Start loading the next page this many slides before the end. */
const LOAD_AHEAD = 3;

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

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * ZP-500: the landing page feed. One look per full-screen slide (vertical
 * scroll snap, one slide per flick), its photos sideways inside the slide.
 * Phones: the whole screen. Computers: the same feed in a centred
 * phone-shaped column on cream, with up/down buttons beside it.
 *
 * State in the URL: the tab in ?c=<slug>, the current slide in
 * #look-<slug> (replaceState, so browser back from a product page lands on
 * the same look; the first slide has no hash). See docs/storefront/feed.md.
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
  const [tab, setTab] = useState(initialTab);
  const [items, setItems] = useState(initialItems);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [total, setTotal] = useState(initialTotal);
  const [active, setActive] = useState(0);
  const [hinted, setHinted] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const request = useRef(0);
  const loading = useRef(false);
  /**
   * URL writes start with the first scroll (the visitor's, or the jump to a
   * remembered slide), so mounting never wipes the #look- hash being restored.
   */
  const ready = useRef(false);
  /** A slide to scroll to once the items it needs have rendered. */
  const pending = useRef<{ slug: string | null } | null>(null);

  const slideCount = items.length + 1; // the looks, then the end (or loading) slide
  const tabLabel = tabs.find((t) => t.id === tab)?.label ?? tabs[0]?.label ?? "";

  // ------------------------------------------------------------ helpers

  const writeUrl = useCallback((nextTab: string, slug: string | null) => {
    const url = feedLocation(window.location.pathname, window.location.search, nextTab, slug);
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", url);
    }
  }, []);

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    const top = Math.max(0, index) * el.clientHeight;
    el.scrollTo({ top, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  }, []);

  const apply = useCallback((result: FeedActionResult, mode: "replace" | "append") => {
    setTab(result.tab);
    setTotal(result.total);
    setNextOffset(result.nextOffset);
    setItems((prev) => {
      if (mode === "replace") return result.items;
      const seen = new Set(prev.map((p) => p.slug));
      return [...prev, ...result.items.filter((p) => !seen.has(p.slug))];
    });
  }, []);

  /**
   * Fetch a page (server action). `scrollTo`: after it renders, jump to that
   * slug (null: the first slide; a slug not in the result: the first slide).
   */
  const load = useCallback(
    async (
      args: { tab: string; offset: number; through?: string | null },
      mode: "replace" | "append",
      scrollTo?: string | null,
    ) => {
      const id = ++request.current;
      loading.current = true;
      try {
        const result = await loadFeedAction(args);
        if (id !== request.current) return null; // a newer tab switch won
        if (scrollTo !== undefined) pending.current = { slug: scrollTo };
        apply(result, mode);
        return result;
      } catch {
        return null;
      } finally {
        if (id === request.current) loading.current = false;
      }
    },
    [apply],
  );

  // Scroll to a pending slide after the items it needs are in the DOM.
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    const index = target.slug ? items.findIndex((p) => p.slug === target.slug) : 0;
    scrollToIndex(Math.max(0, index), false); // onScroll updates the active slide
  }, [items, scrollToIndex]);

  // ----------------------------------------------------- mount: restore

  useEffect(() => {
    // The feed scrolls inside itself; the document must not (on iOS a
    // document scroll would collapse the URL bar and resize the page).
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";

    const urlTab = new URLSearchParams(window.location.search).get(FEED_TAB_PARAM) ?? tabs[0]?.id;
    const slug = parseLookHash(window.location.hash);
    const knownTab = tabs.some((t) => t.id === urlTab) ? (urlTab as string) : initialTab;
    // Loads start from a timer (an event-like callback), not the effect body.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (knownTab !== initialTab) {
      // Back from a product page after a tab switch: the server rendered the old tab.
      timer = setTimeout(() => void load({ tab: knownTab, offset: 0, through: slug }, "replace", slug));
    } else if (slug && initialItems.some((p) => p.slug === slug)) {
      scrollToIndex(initialItems.findIndex((p) => p.slug === slug), false);
    } else if (slug && initialNextOffset !== null) {
      timer = setTimeout(() => void load({ tab: initialTab, offset: initialItems.length, through: slug }, "append", slug));
    }
    return () => {
      clearTimeout(timer);
      html.style.overflow = previous;
    };
    // Mount only: the initial props describe the server render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------- scroll: active slide

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    ready.current = true;
    if (!hinted && el.scrollTop > 40) setHinted(true);
    const index = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
    if (index !== active) setActive(index);
    // Load the next page a few slides before the end.
    if (nextOffset !== null && !loading.current && index >= items.length - LOAD_AHEAD) {
      void load({ tab, offset: nextOffset }, "append");
    }
  };

  useEffect(() => {
    if (!ready.current) return;
    const item = items[Math.min(active, items.length - 1)];
    writeUrl(tab, active > 0 && item ? item.slug : null);
  }, [active, items, tab, writeUrl]);

  // ---------------------------------------------------------- actions

  const selectTab = async (id: string) => {
    setHinted(true);
    if (id === tab) {
      scrollToIndex(0, true);
      return;
    }
    setTab(id);
    const result = await load({ tab: id, offset: 0 }, "replace", null);
    if (!result) return;
    setActive(0); // the new tab starts on its first look
    ready.current = true;
    writeUrl(result.tab, null);
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

  const onLeave = (slug: string) => writeUrl(tab, items[0]?.slug === slug ? null : slug);

  const backToStart = () => {
    scrollToIndex(0, true);
    scroller.current?.focus({ preventScroll: true });
  };

  const openMenu = () => dialogRef.current?.showModal();
  const onMenuClose = () => menuButton.current?.focus();

  // ------------------------------------------------------------ render

  const stepButton =
    "sf-focus flex h-12 w-12 items-center justify-center rounded-full border border-brand-ink/20! bg-brand-cream-50 text-brand-ink transition-colors hover:border-brand-ink! disabled:opacity-40 disabled:hover:border-brand-ink/20!";

  return (
    <div className="flex h-full w-full items-center justify-center gap-6 bg-brand-cream">
      {/* Keeps the column centred against the step buttons on computers. */}
      <span aria-hidden="true" className="hidden w-12 md:block" />

      <div className="relative h-full w-full overflow-hidden bg-brand-ink text-brand-cream-50 md:h-[calc(100%-32px)] md:w-auto md:aspect-[9/16] md:max-w-[calc(100vw-160px)] md:rounded-[4px] md:shadow-[0_18px_50px_rgba(30,30,30,0.22)]">
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
              key={item.slug}
              item={item}
              index={i}
              total={total}
              eager={i === 0}
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
            <section
              aria-label="Loading more looks"
              className="flex h-full snap-start snap-always items-center justify-center bg-[#2a2a26]"
            >
              <p className="sf-label text-brand-cream" role="status">
                Loading more looks…
              </p>
            </section>
          )}
        </div>

        {/* Overlay: menu, wordmark, Visit us, collection tabs. Hidden over the cream end slide. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1.5 px-3 pt-3.5",
            active >= items.length && items.length > 0 && "text-brand-ink",
          )}
        >
          <div className="flex items-center justify-between">
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
            <Link
              href={links.visit}
              aria-label="Visit us"
              className="sf-focus pointer-events-auto flex h-11 w-11 items-center justify-center rounded-[2px]"
            >
              <PinIcon className="h-[22px] w-[22px]" />
            </Link>
          </div>
          {tabs.length > 1 ? (
            <nav aria-label="Collections" className="sf-scroll-x pointer-events-auto -mx-3 flex justify-start gap-1 px-3 [&>*:first-child]:ml-auto [&>*:last-child]:mr-auto">
              {tabs.map((t) => {
                const pressed = t.id === tab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => void selectTab(t.id)}
                    className={cn(
                      "sf-focus min-h-10 shrink-0 whitespace-nowrap rounded-[2px] px-2.5 text-xs font-medium uppercase tracking-[0.14em] [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]",
                      pressed ? "shadow-[inset_0_-2px_0_currentColor]" : "opacity-85",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </nav>
          ) : null}
        </div>

        {!hinted && items.length > 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-2.5 flex flex-col items-center text-brand-cream motion-safe:animate-pulse"
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
    <section
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
    </section>
  );
}
