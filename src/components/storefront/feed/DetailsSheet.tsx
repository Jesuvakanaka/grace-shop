"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { track } from "@/lib/analytics/client";
import { type FeedBadge, type FeedItem } from "@/lib/storefront/feed";
import { loadSheetExtrasAction } from "@/lib/storefront/feed-sheet-actions";
import {
  sheetDragCloses,
  sheetDragOffset,
  sheetHasMore,
  sheetMaxHeight,
  sheetModel,
  sheetScrollStep,
  type SheetCloseReason,
  type SheetExtras,
  type SheetModel,
} from "@/lib/storefront/feed-sheet";
import { todayLine } from "@/lib/storefront/menu-model";
import { enquiryEvent } from "@/lib/storefront/tracking";
import { cn } from "../cn";
import { CloseIcon, PhoneIcon, WhatsAppLogoIcon } from "../icons";
import { LoveButton } from "../loves/LoveButton";
import { ProductEnquiryProvider, ProductOptions, useEnquiry } from "../product/ProductEnquiry";
import { StoreVisitRow } from "../product/StoreVisitRow";
import { useShare } from "../product/useShare";
import { ChevronIcon, PinIcon, ShareIcon } from "./feed-icons";

// Slide-up on open, the nudging chevron of the "More" pill and the CSS max
// height (the JS one from the visible viewport overrides it). Hoisted once
// by React (href + precedence). Reduced motion: no animation.
const SHEET_CSS = `
@keyframes vy-sheet-up{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes vy-sheet-nudge{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
.vy-details-sheet{max-height:62vh;max-height:62dvh}
.vy-details-sheet[open]{animation:vy-sheet-up .22s ease-out}
.vy-sheet-nudge{animation:vy-sheet-nudge 1.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.vy-details-sheet[open],.vy-sheet-nudge{animation:none}}
`;

/** Light-background tag colours (Sold out ink, Few left lime, New olive outline). */
const badgeTone: Record<FeedBadge["kind"], string> = {
  "sold-out": "bg-brand-ink text-brand-cream-50",
  "few-left": "bg-brand-lime text-brand-ink",
  new: "border border-brand-olive-700/50 text-brand-olive-700",
};

/** The enquiry provider's settings before the extras arrive (no link: the slide's one is used). */
const NO_CONTACTS = { whatsappNumber: null, enquiryTemplate: "", generalEnquiryMessage: "" };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --------------------------------------------------------------- extras

type Loaded = { slug: string; extras: SheetExtras | null; failed: boolean };

/** One request per slug per page load (the server reads only cached public data). */
const extrasCache = new Map<string, Promise<SheetExtras | null>>();

function fetchExtras(slug: string): Promise<SheetExtras | null> {
  let pending = extrasCache.get(slug);
  if (!pending) {
    pending = loadSheetExtrasAction(slug).catch((error: unknown) => {
      extrasCache.delete(slug); // a later open tries again
      throw error;
    });
    extrasCache.set(slug, pending);
  }
  return pending;
}

function useSheetExtras(slug: string | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    fetchExtras(slug).then(
      (extras) => {
        if (live) setLoaded({ slug, extras, failed: false });
      },
      () => {
        if (!live) return;
        setLoaded({ slug, extras: null, failed: true });
        track("action_failed", { slug, action: "details_sheet" });
      },
    );
    return () => {
      live = false;
    };
  }, [slug]);
  return loaded && loaded.slug === slug ? loaded : null;
}

// ---------------------------------------------------------------- sheet

/** Where the footer's fallback and Call go: /visit, and tel: of the shop phone (null hides Call). */
type SheetLinks = { visit: string; call: string | null };

type DetailsSheetProps = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  /** The look whose details are open; null when closed. */
  item: FeedItem | null;
  /** The feed tab, sent with the sheet's events. */
  collection: string;
  links: SheetLinks;
  /** A close from the sheet's own controls (drag, backdrop, ✕, Escape). */
  onRequestClose: (reason: SheetCloseReason) => void;
};

/**
 * ZP-510: the details bottom sheet over the current look (Details, the
 * caption or the photo; the feed does not move). A native modal <dialog>
 * (showModal: the feed behind is inert), labelled by the piece's name, which
 * takes the focus. Details only, no photos: collection, name, price, tag,
 * rating and the heart, colour and size (the chosen size goes into the
 * WhatsApp message), description, "Try it on in store", the first two
 * reviews, "View full page"; a pinned footer with the WhatsApp button (or
 * Visit us) and Share. At most 62% of the visible viewport high, so the top
 * of the look stays visible. Closes by dragging the handle down, a tap on the
 * backdrop, ✕, Escape and the browser back button (FlipFeed owns the
 * `?d=<slug>` history entry). See docs/storefront/feed.md.
 */
export function DetailsSheet({ dialogRef, item, collection, links, onRequestClose }: DetailsSheetProps) {
  const titleId = useId();
  const slug = item?.slug ?? null;
  const loaded = useSheetExtras(slug);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const downOnBackdrop = useRef(false);

  // Open / close with the look (layout effect: never a frame of an empty or stale sheet).
  useLayoutEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (slug && !d.open) {
      d.showModal();
      // Focus starts on the title (the dialog's name), so the piece is announced first.
      d.querySelector<HTMLElement>("[data-sheet-title]")?.focus({ preventScroll: true });
    } else if (!slug && d.open) {
      d.close();
    }
  }, [slug, dialogRef]);

  // 62% of what is on screen (bottom toolbars, Samsung Internet), again on resize.
  useEffect(() => {
    if (!slug) return;
    const measure = () => {
      const vv = window.visualViewport;
      setMaxHeight(sheetMaxHeight({ innerHeight: window.innerHeight, visualHeight: vv?.height ?? null, visualScale: vv?.scale ?? 1 }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [slug]);

  // Escape: one close path (the URL / history entry), not the dialog's own.
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onRequestClose("escape");
  };
  // The dialog closed without us (a browser that does not let Escape be cancelled).
  const onClose = () => {
    if (slug) onRequestClose("escape");
  };
  // A tap on the backdrop (both pointerdown and click there, so a drag from inside never closes).
  const onDialogPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    downOnBackdrop.current = event.target === event.currentTarget;
  };
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    const both = downOnBackdrop.current && event.target === event.currentTarget;
    downOnBackdrop.current = false;
    if (both) onRequestClose("backdrop");
  };

  // Drag the handle row down to close (touch-action: none there; buttons keep their clicks).
  const onHandleDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button, a")) return;
    dragStart.current = event.clientY;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture (old browser): the drag still works while the pointer stays on the handle.
    }
  };
  const onHandleMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    setDrag(sheetDragOffset(dragStart.current, event.clientY));
  };
  const onHandleUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    const offset = sheetDragOffset(dragStart.current, event.clientY);
    dragStart.current = null;
    setDrag(0);
    if (sheetDragCloses(offset)) onRequestClose("swipe");
  };
  const onHandleCancel = () => {
    dragStart.current = null;
    setDrag(0);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={onCancel}
      onClose={onClose}
      onPointerDown={onDialogPointerDown}
      onClick={onDialogClick}
      style={{
        ...(maxHeight ? { maxHeight } : {}),
        transform: drag > 0 ? `translateY(${drag}px)` : undefined,
        transition: drag > 0 ? "none" : "transform 0.2s ease",
      }}
      className="vy-details-sheet fixed inset-x-0 bottom-0 top-auto mx-auto my-0 w-full max-w-full overflow-hidden rounded-t-[16px] border-0 bg-brand-cream-50 p-0 text-brand-ink shadow-[0_-10px_30px_rgba(0,0,0,0.25)] backdrop:bg-[rgba(20,20,18,0.18)] md:bottom-4 md:max-w-[calc((100svh-32px)*9/16)]"
    >
      <style href="vyra-details-sheet" precedence="default">
        {SHEET_CSS}
      </style>
      {item ? (
        // Keyed per piece: the chosen size and the scroll start afresh.
        <SheetContent
          key={item.slug}
          item={item}
          loaded={loaded}
          titleId={titleId}
          collection={collection}
          links={links}
          onClose={() => onRequestClose("button")}
          handle={{ onPointerDown: onHandleDown, onPointerMove: onHandleMove, onPointerUp: onHandleUp, onPointerCancel: onHandleCancel }}
        />
      ) : null}
    </dialog>
  );
}

type HandleProps = {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
};

function SheetContent({
  item,
  loaded,
  titleId,
  collection,
  links,
  onClose,
  handle,
}: {
  item: FeedItem;
  loaded: Loaded | null;
  titleId: string;
  collection: string;
  links: SheetLinks;
  onClose: () => void;
  handle: HandleProps;
}) {
  const extras = loaded?.extras ?? null;
  const model = sheetModel(item, extras);
  const inner = (
    <SheetLayout
      item={item}
      extras={extras}
      loading={loaded === null}
      model={model}
      titleId={titleId}
      collection={collection}
      links={links}
      onClose={onClose}
      handle={handle}
    />
  );
  // The same provider as the product page: chips and the WhatsApp link agree (ZP-490).
  // Always rendered (a stable tree: the focused title must not remount when the extras
  // arrive); until then it has no WhatsApp number and the footer uses the slide's link.
  return (
    <ProductEnquiryProvider
      contacts={extras?.contacts ?? NO_CONTACTS}
      productName={item.name}
      productUrl={item.shareUrl}
      availability={extras?.availability ?? (item.soldOut ? "SOLD_OUT" : "IN_STOCK")}
      productRef={extras?.ref ?? null}
      slug={item.slug}
    >
      {inner}
    </ProductEnquiryProvider>
  );
}

function SheetLayout({
  item,
  extras,
  loading,
  model,
  titleId,
  collection,
  links,
  onClose,
  handle,
}: {
  item: FeedItem;
  extras: SheetExtras | null;
  loading: boolean;
  model: SheetModel;
  titleId: string;
  collection: string;
  links: SheetLinks;
  onClose: () => void;
  handle: HandleProps;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const reviewsId = useId();

  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setMore(sheetHasMore(el));
  }, []);
  // Content grows (extras arrive, "Try it on in store" opens) or the sheet resizes.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const timer = setTimeout(measure);
    if (typeof ResizeObserver === "undefined") return () => clearTimeout(timer);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(inner);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [measure]);

  const scrollDown = () => {
    const el = scroller.current;
    if (!el) return;
    const from = el.scrollTop;
    const top = sheetScrollStep(el.clientHeight);
    el.scrollBy({ top, behavior: reducedMotion() ? "auto" : "smooth" });
    // Some browsers (throttled or embedded views) never run the smooth scroll: jump instead.
    setTimeout(() => {
      if (el.isConnected && el.scrollTop === from) el.scrollTop = from + top;
    }, 450);
  };

  const visit = extras?.visit ?? null;
  const summary = extras?.reviews.summary ?? null;

  return (
    <div className="flex max-h-[inherit] flex-col">
      {/* Handle row: drag it down to close. The title and ✕ live here too (the design). */}
      <div
        {...handle}
        className="flex shrink-0 cursor-grab touch-none select-none flex-col gap-1.5 pb-1 pl-5 pr-3 pt-2.5"
      >
        <span aria-hidden="true" className="h-1 w-10 self-center rounded-[2px] bg-brand-ink/25" />
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand-olive-700">{item.category}</span>
            <h2
              id={titleId}
              data-sheet-title=""
              tabIndex={-1}
              className="m-0 font-serif text-[26px] font-semibold leading-[1.1] text-balance outline-none"
            >
              {item.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="sf-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] text-brand-ink"
          >
            <CloseIcon className="h-[22px] w-[22px]" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={measure}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div ref={content} className="flex flex-col gap-[18px] px-5 pb-4 pt-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="m-0 text-xl font-medium">
                <span className="sr-only">Price: </span>
                {item.price}
              </p>
              {item.badge ? (
                <span
                  className={cn(
                    "rounded-[2px] px-2 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.16em]",
                    badgeTone[item.badge.kind],
                  )}
                >
                  {item.badge.label}
                </span>
              ) : null}
            </div>

            <div className="-mt-2 flex flex-wrap items-center justify-between gap-3">
              {model.rating ? (
                <p className="m-0 inline-flex items-center gap-1.5 text-sm">
                  {model.rating.stars ? (
                    <span aria-hidden="true" className="tracking-[0.06em] text-brand-olive-700">
                      {model.rating.stars}
                    </span>
                  ) : null}
                  <span aria-hidden="true">{model.rating.text}</span>
                  <span className="sr-only">{model.rating.label}</span>
                </p>
              ) : (
                <span />
              )}
              <LoveButton slug={item.slug} name={item.name} loves={item.loves} variant="pill" />
            </div>

            {extras ? (
              <ProductOptions colours={extras.colours} sizes={extras.sizes} />
            ) : loading ? (
              <p role="status" className="m-0 text-sm text-brand-ink-soft">
                Loading details…
              </p>
            ) : null}

            {extras?.description ? (
              <p className="m-0 whitespace-pre-line text-[15px] leading-[1.6] text-brand-ink-soft">{extras.description}</p>
            ) : null}

            {visit ? <StoreVisitRow visit={visit} today={todayLine(visit.hours, new Date())} /> : null}

            {model.showReviews && extras ? (
              <section aria-labelledby={reviewsId} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 id={reviewsId} className="m-0 font-serif text-[22px] font-medium">
                    Reviews
                  </h3>
                  {model.shopRating ? (
                    <p className="m-0 text-xs text-brand-ink-soft">
                      <span aria-hidden="true">{model.shopRating.text}</span>
                      <span className="sr-only">{model.shopRating.label}</span>
                    </p>
                  ) : null}
                </div>
                {summary ? (
                  <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                    {extras.reviews.top.map((r, i) => (
                      <li key={`${r.dateTime}-${i}`} className="flex flex-col gap-1 border-b border-brand-ink/10! pb-2.5">
                        <span role="img" aria-label={r.starsLabel} className="text-[13px] tracking-[0.06em] text-brand-olive-700">
                          {r.starsText}
                        </span>
                        <p className="m-0 whitespace-pre-line break-words text-sm leading-[1.55]">{r.comment}</p>
                        <span className="text-xs text-brand-ink-soft">
                          {r.name} · Verified buyer · <time dateTime={r.dateTime}>{r.date}</time>
                        </span>
                        {r.reply ? (
                          <p className="m-0 ml-3 border-l-2 border-brand-olive! bg-brand-cream-100 px-3 py-2 text-[13px] leading-normal text-brand-ink-soft">
                            <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-olive-700">Reply from VYRA</span>
                            <span className="whitespace-pre-line break-words">{r.reply}</span>
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-sm leading-relaxed text-brand-ink-soft">No reviews for this piece yet.</p>
                )}
                {model.seeAll ? (
                  <Link
                    href={model.seeAll.href}
                    className="sf-focus inline-flex min-h-10 items-center self-start rounded-[2px] text-xs font-medium uppercase tracking-[0.16em] text-brand-olive-700"
                  >
                    {model.seeAll.text}
                  </Link>
                ) : null}
              </section>
            ) : null}

            <Link
              href={model.fullPageHref}
              className="sf-focus inline-flex min-h-11 items-center self-center rounded-[2px] px-2 text-xs uppercase tracking-[0.12em] text-brand-ink-soft underline underline-offset-4"
            >
              View full page
            </Link>
          </div>
        </div>

        {more ? (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(rgba(251,249,244,0),rgba(251,249,244,0.96))]"
            />
            <button
              type="button"
              onClick={scrollDown}
              aria-label="Scroll down for store details and reviews"
              className="sf-focus absolute bottom-2 left-1/2 inline-flex min-h-9 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-ink/20! bg-brand-cream-50 px-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-brand-olive-700 shadow-[0_2px_10px_rgba(0,0,0,0.08)]"
            >
              More: store &amp; reviews
              <ChevronIcon direction="down" className="vy-sheet-nudge h-4 w-4" />
            </button>
          </>
        ) : null}
      </div>

      <EnquiryFooter item={item} model={model} collection={collection} links={links} />
    </div>
  );
}

/** The footer with the chosen size / colour in the WhatsApp message (inside the enquiry provider). */
function EnquiryFooter(props: { item: FeedItem; model: SheetModel; collection: string; links: SheetLinks }) {
  const { href, size, colour } = useEnquiry();
  return <SheetFooter {...props} href={href ?? props.item.enquireHref} size={size} colour={colour} />;
}

function SheetFooter({
  item,
  model,
  collection,
  links,
  href,
  size = null,
  colour = null,
}: {
  item: FeedItem;
  model: SheetModel;
  collection: string;
  links: SheetLinks;
  href: string | null;
  size?: string | null;
  colour?: string | null;
}) {
  const { status, share } = useShare();
  const { slug } = item;
  const primary =
    "sf-focus flex min-h-[52px] flex-1 items-center justify-center gap-2.5 rounded-[2px] bg-brand-olive px-4 text-[13px] font-medium uppercase tracking-[0.14em] text-brand-cream-50 hover:bg-brand-olive-700";

  const enquire = () => {
    const e = enquiryEvent({ soldOut: item.soldOut, screen: "feed", size, colour });
    track(e.type, { slug, collection, ...e.props });
  };
  const onShare = async () => {
    const outcome = await share(item.shareUrl as string, `${item.name} – VYRA`);
    if (outcome === "native" || outcome === "copy") track("share", { slug, collection, method: outcome, screen: "feed" });
  };

  return (
    <div className="relative flex shrink-0 gap-2.5 border-t border-brand-ink/10! bg-brand-cream-50 px-4 pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-2.5">
      {model.primary.kind !== "visit" && href ? (
        // A plain wa.me link (no target, no window.open): phones hand it to the WhatsApp app.
        <a href={href} onClick={enquire} className={primary}>
          <WhatsAppLogoIcon className="h-5 w-5 shrink-0" />
          <span>{model.primary.label}</span>
        </a>
      ) : (
        <Link href={links.visit} onClick={() => track("visit_us", { screen: "feed" })} className={primary}>
          <PinIcon className="h-5 w-5 shrink-0" />
          <span>Visit us</span>
        </Link>
      )}
      {links.call ? (
        <a
          href={links.call}
          onClick={() => track("call", { slug, collection, screen: "feed" })}
          aria-label="Call VYRA"
          className="sf-focus flex min-h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[2px] border border-brand-ink! text-brand-ink"
        >
          <PhoneIcon className="h-5 w-5" />
        </a>
      ) : null}
      {item.shareUrl ? (
        <button
          type="button"
          onClick={() => void onShare()}
          aria-label={`Share the ${item.name}`}
          className="sf-focus flex min-h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[2px] border border-brand-ink! text-brand-ink"
        >
          <ShareIcon className="h-5 w-5" />
        </button>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "absolute inset-x-4 bottom-full mb-2 rounded-[2px] bg-brand-ink px-4 py-3 text-[13px] leading-normal text-brand-cream-50 shadow-[0_8px_24px_rgba(0,0,0,0.25)]",
          status === "idle" && "sr-only",
        )}
      >
        {status === "copied" ? "Link copied. Paste it anywhere to share." : status === "failed" ? `Copy this link: ${item.shareUrl}` : ""}
      </p>
    </div>
  );
}
