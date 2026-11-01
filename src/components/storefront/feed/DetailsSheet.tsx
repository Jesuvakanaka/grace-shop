"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
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
  alsoLikeTitle,
  chosenColour,
  colourSizeLabel,
  descriptionToggle,
  howToBuy,
  sheetDragCloses,
  sheetDragOffset,
  sheetHasMore,
  sheetMaxHeight,
  morePillText,
  reviewsMore,
  SHEET_TOP_REVIEWS,
  sheetModel,
  sheetScrollStep,
  socialLine,
  tryItOnText,
  type AlsoLikePiece,
  type HowToBuyCell,
  type SheetCloseReason,
  type SheetExtras,
  type SheetModel,
} from "@/lib/storefront/feed-sheet";
import { todayLine } from "@/lib/storefront/menu-model";
import { toggleOption } from "@/lib/storefront/product-enquiry";
import { allowedOption, enquiryEvent } from "@/lib/storefront/tracking";
import { cn } from "../cn";
import { CloseIcon, MapPinIcon, PhoneIcon, WhatsAppLogoIcon } from "../icons";
import { LoveButton } from "../loves/LoveButton";
import { ProductEnquiryProvider, useEnquiry } from "../product/ProductEnquiry";
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

/**
 * One request per slug while this JavaScript bundle lives (module scope: it
 * survives client-side navigations and is cleared by a full page load; a
 * failed request is removed so the next open tries again). The server reads
 * only cached public data, which is at most a minute old anyway.
 */
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

/**
 * The extras of the open look. `seed` (ZP-512: the owner preview of an
 * unpublished piece, rendered by the server) is used as is for its slug:
 * the server action only knows published pieces.
 */
function useSheetExtras(slug: string | null, seed: SheetExtras | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const seeded = seed !== null && seed.slug === slug;
  useEffect(() => {
    if (!slug || seeded) return;
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
  }, [slug, seeded]);
  if (seeded) return { slug: seed.slug, extras: seed, failed: false };
  return loaded && loaded.slug === slug ? loaded : null;
}

/** ZP-512: the sheet of an owner preview (unpublished piece): no heart. */
const SheetPreviewContext = createContext(false);
/** ZP-513: "You may also like" -> close the sheet and go to that look in the feed (FlipFeed). */
const GoToLookContext = createContext<((from: string, to: string) => void) | null>(null);

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
  /** ZP-512: extras rendered by the server (owner preview), used instead of fetching. */
  seedExtras?: SheetExtras | null;
  /** ZP-512: owner preview of an unpublished piece (no heart). */
  preview?: boolean;
  /** ZP-513: a "You may also like" tap: close the sheet and go to that look (from = the open piece). */
  onGoToLook?: (from: string, to: string) => void;
};

/**
 * ZP-510: the details bottom sheet over the current look (Details, the
 * caption or the photo; the feed does not move). A native modal <dialog>
 * (showModal: the feed behind is inert), labelled by the piece's name, which
 * takes the focus. Details only, no photos: collection, name, price, tag,
 * rating and the heart, colour and size (the chosen size goes into the
 * WhatsApp message), description, "Try it on in store", the reviews (two,
 * then "See all N reviews" opens the rest here, ZP-512); a pinned footer with
 * the WhatsApp button (or Visit us), Call and Share. At most 62% of the visible viewport high, so the top
 * of the look stays visible. Closes by dragging the handle down, a tap on the
 * backdrop, ✕, Escape and the browser back button (FlipFeed owns the
 * `?d=<slug>` history entry). See docs/storefront/feed.md.
 */
export function DetailsSheet({
  dialogRef,
  item,
  collection,
  links,
  onRequestClose,
  seedExtras = null,
  preview = false,
  onGoToLook,
}: DetailsSheetProps) {
  const titleId = useId();
  const slug = item?.slug ?? null;
  const loaded = useSheetExtras(slug, seedExtras);
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
    // Primary button / touch / pen only; buttons and links in the row keep their clicks.
    if (event.button !== 0 || (event.target as Element).closest("button, a")) return;
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
        <SheetPreviewContext.Provider value={preview}>
        <GoToLookContext.Provider value={onGoToLook ?? null}>
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
        </GoToLookContext.Provider>
        </SheetPreviewContext.Provider>
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
      // Review: a piece's only colour goes into the WhatsApp message (no picker for one colour).
      defaultColour={chosenColour({ colours: extras?.colours ?? [], chosen: null })}
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
  const preview = useContext(SheetPreviewContext);

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
  const reviewsRef = useRef<HTMLElement>(null);
  // ZP-513: the social line (real numbers, each part from 3), "How to buy", "Try it on".
  const social = socialLine({ loves: item.loves, asked: extras?.asked ?? 0 });
  const todayText = visit ? (todayLine(visit.hours, new Date())?.text ?? null) : null;
  const buyCells = extras
    ? howToBuy({
        soldOut: item.soldOut,
        hasWhatsApp: item.enquireHref !== null,
        holdHours: extras.buying.holdHours,
        paymentMethods: extras.buying.paymentMethods,
        todayText,
      })
    : [];
  const tryItOn = tryItOnText(todayText);
  // ZP-512: the first 2 reviews, more on request (SheetContent is keyed per piece, so this starts afresh).
  const [reviewsShown, setReviewsShown] = useState(SHEET_TOP_REVIEWS);
  const moreReviews = extras && summary
    ? reviewsMore({ shown: reviewsShown, total: extras.reviews.list.length, count: summary.count })
    : null;

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
            {/* ZP-513: price, tag and the heart on one row. */}
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
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
              {!preview ? (
                <LoveButton slug={item.slug} name={item.name} loves={item.loves} variant="pill" className="shrink-0" />
              ) : null}
            </div>

            {/* Rating (jumps to the reviews below) and the social line; hidden when neither. */}
            {model.rating || social ? (
              <div className="-mt-2.5 flex flex-col gap-1">
                {model.rating ? (
                  <button
                    type="button"
                    // Review: the reviews block exists only once the extras have arrived; until then nothing to jump to.
                    disabled={!(extras && model.showReviews)}
                    onClick={() => reviewsRef.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" })}
                    className="sf-focus inline-flex items-center gap-1.5 self-start rounded-[2px] text-[13px] text-brand-ink disabled:cursor-default"
                  >
                    {model.rating.stars ? (
                      <span aria-hidden="true" className="tracking-[0.06em] text-brand-olive-700">
                        {model.rating.stars}
                      </span>
                    ) : null}
                    <span aria-hidden="true">{model.rating.text}</span>
                    <span className="sr-only">
                      {model.rating.label}
                      {extras && model.showReviews ? ". Go to the reviews" : ""}
                    </span>
                  </button>
                ) : null}
                {social ? <p className="m-0 text-xs text-brand-olive-700">{social}</p> : null}
              </div>
            ) : null}

            {extras ? (
              <SizeAndFit extras={extras} slug={item.slug} />
            ) : loading ? (
              <p role="status" className="m-0 text-sm text-brand-ink-soft">
                Loading details…
              </p>
            ) : null}

            {buyCells.length > 0 ? <HowToBuy cells={buyCells} /> : null}

            {extras && (extras.description || extras.fabric || extras.care) ? <Description extras={extras} /> : null}

            {tryItOn || visit?.directionsHref ? (
              <div className="-mt-1.5 flex min-h-11 items-center justify-between gap-2.5">
                {tryItOn ? (
                  <p className="m-0 inline-flex items-center gap-2 text-[13px]">
                    <MapPinIcon className="h-4 w-4 shrink-0 text-brand-olive-700" />
                    <span>
                      Try it on: <span className="text-brand-ink-soft">{tryItOn}</span>
                    </span>
                  </p>
                ) : (
                  <span />
                )}
                {visit?.directionsHref ? (
                  <a
                    href={visit.directionsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track("directions", { screen: "feed" })}
                    className="sf-focus inline-flex min-h-11 items-center rounded-[2px] text-xs font-medium text-brand-olive-700"
                  >
                    Directions<span className="sr-only"> (opens Google Maps in a new tab)</span>
                  </a>
                ) : null}
              </div>
            ) : null}

            {extras && extras.alsoLike.length > 0 ? (
              <AlsoLike title={alsoLikeTitle(item.soldOut)} pieces={extras.alsoLike} from={item.slug} />
            ) : null}

            {model.showReviews && extras ? (
              <section ref={reviewsRef} aria-labelledby={reviewsId} className="flex scroll-mt-2 flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 id={reviewsId} className="m-0 font-serif text-xl font-medium">
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
                    {extras.reviews.list.slice(0, reviewsShown).map((r, i) => (
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
                {/* ZP-512: the rest of the reviews open here, 5 at a time (no product page any more). */}
                {moreReviews ? (
                  <button
                    type="button"
                    onClick={() => setReviewsShown(moreReviews.next)}
                    className="sf-focus inline-flex min-h-10 items-center self-start rounded-[2px] text-xs font-medium uppercase tracking-[0.16em] text-brand-olive-700"
                  >
                    {moreReviews.label}
                  </button>
                ) : null}
              </section>
            ) : null}
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
              className="sf-focus absolute bottom-2 left-1/2 inline-flex min-h-9 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-ink/20! bg-brand-cream-50 px-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-brand-olive-700 shadow-[0_2px_10px_rgba(0,0,0,0.08)]"
            >
              {/* The visible text is the accessible name; only the sections that exist. */}
              {morePillText({ store: buyCells.length > 0 || tryItOn !== null, reviews: model.showReviews && extras !== null })}
              <ChevronIcon direction="down" className="vy-sheet-nudge h-4 w-4" />
            </button>
          </>
        ) : null}
      </div>

      <EnquiryFooter item={item} model={model} collection={collection} links={links} />
    </div>
  );
}

// ------------------------------------------------------- ZP-513 sections

const chip =
  "sf-focus inline-flex min-h-[42px] min-w-12 items-center justify-center rounded-[2px] border px-2.5 text-sm transition-colors duration-200";
const chipOn = "border-brand-ink! bg-brand-ink text-brand-cream-50";
const chipOff = "border-brand-ink/20! bg-white text-brand-ink hover:border-brand-ink!";
const sectionLabel = "text-[11px] font-medium uppercase tracking-[0.16em] text-brand-ink-soft";

/**
 * "Colour: Olive · Size" (a colour picker only with more than one colour),
 * the size chips (the chosen size goes into the WhatsApp message), "Size
 * guide" (an inline table of the piece's sizes; only when there is a chart)
 * and the fit note. Hidden parts leave no gap.
 */
function SizeAndFit({ extras, slug }: { extras: SheetExtras; slug: string }) {
  const { colour, size, setColour, setSize } = useEnquiry();
  const [guide, setGuide] = useState(false);
  const tableId = useId();
  const heading = colourSizeLabel(extras.colours, extras.sizes);
  if (!heading && !extras.fit) return null;
  const pickColour = (value: string) => {
    const next = toggleOption(colour, value);
    setColour(next);
    const c = allowedOption("colour", next);
    if (c) track("colour_select", { slug, colour: c });
  };
  const pickSize = (value: string) => {
    const next = toggleOption(size, value);
    setSize(next);
    const s = allowedOption("size", next);
    if (s) track("size_select", { slug, size: s });
  };
  const toggleGuide = () => {
    if (!guide) track("size_guide_open", { slug });
    setGuide((v) => !v);
  };
  return (
    <div className="flex flex-col gap-2">
      {heading?.picker ? (
        <div role="group" aria-label="Colour" className="flex flex-col gap-2">
          <span className={sectionLabel}>
            Colour{colour ? <span className="text-brand-ink">: {colour}</span> : null}
          </span>
          <div className="flex flex-wrap gap-2">
            {extras.colours.map((c) => (
              <button key={c} type="button" aria-pressed={c === colour} onClick={() => pickColour(c)} className={cn(chip, c === colour ? chipOn : chipOff)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {heading && (heading.label || heading.colour) ? (
        <div className="flex items-baseline justify-between gap-2">
          <span className={sectionLabel}>
            {heading.colour ? (
              <>
                Colour: <span className="text-brand-ink">{heading.colour}</span>
                {heading.label ? " · " : ""}
              </>
            ) : null}
            {heading.label}
            {heading.label && size ? <span className="text-brand-ink">: {size}</span> : null}
          </span>
          {extras.sizeChart && heading.label ? (
            <button
              type="button"
              onClick={toggleGuide}
              aria-expanded={guide}
              aria-controls={tableId}
              className="sf-focus min-h-8 rounded-[2px] text-xs font-medium text-brand-olive-700 underline underline-offset-2"
            >
              Size guide
            </button>
          ) : null}
        </div>
      ) : null}
      {extras.sizes.length > 0 ? (
        <div role="group" aria-label="Size" className="flex flex-wrap gap-2">
          {extras.sizes.map((s) => (
            <button key={s} type="button" aria-pressed={s === size} onClick={() => pickSize(s)} className={cn(chip, s === size ? chipOn : chipOff)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {extras.fit ? <p className="m-0 text-xs leading-normal text-brand-ink-soft">{extras.fit}</p> : null}
      {guide && extras.sizeChart ? (
        <table id={tableId} className="w-full border-collapse text-xs text-brand-ink">
          <caption className="pb-1.5 text-left text-[11px] text-brand-ink-soft">Body measurements in cm</caption>
          <thead>
            <tr>
              {["Size", "Bust", "Waist", "Hips"].map((h) => (
                <th key={h} scope="col" className="border-b border-brand-ink/15! px-1 py-1.5 text-left font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {extras.sizeChart.map((r) => (
              <tr key={r.size}>
                <th scope="row" className="border-b border-brand-ink/10! px-1 py-1.5 text-left font-medium">
                  {r.size}
                </th>
                <td className="border-b border-brand-ink/10! px-1 py-1.5">{r.bust}</td>
                <td className="border-b border-brand-ink/10! px-1 py-1.5">{r.waist}</td>
                <td className="border-b border-brand-ink/10! px-1 py-1.5">{r.hips}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function BuyIcon({ kind }: { kind: HowToBuyCell["kind"] }) {
  if (kind === "reserve") return <WhatsAppLogoIcon className="h-5 w-5 text-[#25D366]" />;
  const d =
    kind === "pay"
      ? ["M3 6h18v13H3z", "M3 10h18", "M7 15h3"]
      : ["M4 10l1.5-5h13L20 10", "M4 10h16v9H4z", "M9 19v-5h6v5"];
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="h-5 w-5 text-brand-olive-700" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** "How to buy": Reserve on WhatsApp · Pay in store · Collect in store (only the cells with data). */
function HowToBuy({ cells }: { cells: HowToBuyCell[] }) {
  return (
    <ul
      aria-label="How to buy"
      className="m-0 grid list-none gap-2 border-y border-brand-ink/10! px-0 py-2.5"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells.map((c) => (
        <li key={c.kind} className="flex flex-col items-center gap-1 text-center">
          <BuyIcon kind={c.kind} />
          <span className="text-[11px] font-semibold leading-tight">{c.title}</span>
          {c.text ? <span className="text-[11px] leading-snug text-brand-ink-soft">{c.text}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The description on 2 lines with "More · fabric & care" (or "More"), and fabric / care when open. */
function Description({ extras }: { extras: SheetExtras }) {
  const [open, setOpen] = useState(false);
  const toggle = descriptionToggle({ description: extras.description, fabric: extras.fabric, care: extras.care });
  const panelId = useId();
  return (
    <div className="flex flex-col gap-1">
      {extras.description ? (
        <p className={cn("m-0 whitespace-pre-line text-sm leading-[1.6] text-brand-ink-soft", !open && toggle && "line-clamp-2")}>
          {extras.description}
        </p>
      ) : null}
      {toggle ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={open && (extras.fabric || extras.care) ? panelId : undefined}
          className="sf-focus min-h-8 self-start rounded-[2px] text-xs font-medium text-brand-olive-700"
        >
          {open ? "Less" : toggle}
        </button>
      ) : null}
      {open && (extras.fabric || extras.care) ? (
        <dl id={panelId} className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          {extras.fabric ? (
            <>
              <dt className="text-brand-ink-soft">Fabric</dt>
              <dd className="m-0">{extras.fabric}</dd>
            </>
          ) : null}
          {extras.care ? (
            <>
              <dt className="text-brand-ink-soft">Care</dt>
              <dd className="m-0">{extras.care}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * "You may also like" / "Available now": up to 4 available pieces (small
 * photo, name, price). A tap closes the sheet and takes the shopper to that
 * piece's look in the feed (FlipFeed's goToLook), tracked as also_like_open.
 */
function AlsoLike({ title, pieces, from }: { title: string; pieces: AlsoLikePiece[]; from: string }) {
  const goToLook = useContext(GoToLookContext);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <h3 id={headingId} className="m-0 font-serif text-xl font-medium">
        {title}
      </h3>
      <ul className="-mx-5 m-0 flex list-none gap-2.5 overflow-x-auto px-5 py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pieces.map((p) => (
          <li key={p.slug} className="flex-none basis-[104px]">
            <button
              type="button"
              onClick={() => goToLook?.(from, p.slug)}
              className="sf-focus flex w-[104px] flex-col gap-1 rounded-[2px] text-left text-brand-ink"
            >
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- storefront photos use <img srcset> (public data layer)
                <img
                  src={p.image.src}
                  srcSet={p.image.srcSet || undefined}
                  sizes="104px"
                  alt=""
                  width={104}
                  height={132}
                  loading="lazy"
                  decoding="async"
                  className="block h-[132px] w-[104px] rounded-[2px] bg-brand-cream-200 object-cover object-[50%_20%]"
                />
              ) : (
                <span aria-hidden="true" className="block h-[132px] w-[104px] rounded-[2px] bg-brand-cream-200" />
              )}
              <span className="text-xs leading-snug">{p.name}</span>
              <span className="text-xs font-medium">{p.price}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
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
