"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { track, useActiveDwell, useDwell } from "@/lib/analytics/client";
import { lookAnchorId, photoLinkLabel, photoNav, railItems, type FeedBadge, type FeedItem } from "@/lib/storefront/feed";
import { TOUR_SETTLE_MS, tourPhotoMs } from "@/lib/storefront/feed-guide";
import {
  INFO_MODE_START,
  infoActions,
  infoAvailability,
  infoModeTrack,
  infoPhotoRail,
  infoPrice,
  infoPrimary,
  infoSlimLine,
  isVisitorPhotoChange,
  nextInfoMode,
  type FeedView,
  type InfoAvailability,
  type InfoMode,
  type InfoModeEvent,
} from "@/lib/storefront/feed-view";
import { isPlainClick } from "@/lib/storefront/feed-sheet";
import { mediaItems } from "@/lib/storefront/feed-media";
import { enquiryEvent, photoProps } from "@/lib/storefront/tracking";
import { cn } from "../cn";
import { LoveButton } from "../loves/LoveButton";
import { useShare } from "../product/useShare";
import { ImageFallback } from "../StorefrontImage";
import { FeedPhoto } from "./FeedPhoto";
import { FeedVideo } from "../video/FeedVideo";
import { PhoneIcon, WhatsAppLogoIcon } from "../icons";
import { ChevronIcon, CornersIcon, DetailsIcon, EyeIcon, PinIcon, ShareIcon } from "./feed-icons";

/** Phones and touch tablets: the full width; computers: the phone-shaped column (about 9/16 of the viewport height). */
const SLIDE_SIZES = "(min-width: 768px) and (pointer: fine) 57vh, 100vw";

const badgeTone: Record<FeedBadge["kind"], string> = {
  "sold-out": "bg-brand-cream-50 text-brand-ink",
  "few-left": "bg-brand-lime text-brand-ink",
  "pre-order": "bg-brand-lime text-brand-ink",
  new: "border border-brand-cream-50/70 bg-brand-cream-50/20 text-brand-cream-50",
};

// The rail: round controls with a small label under them.
// ZP-510: short screens (height <= 700px, e.g. 360×580) get a tighter rail
// (smaller rings and gaps; Call and the eye without their text, the
// aria-labels stay), so six controls stay below the top bar and photo arrows.
const railItem =
  "sf-focus flex flex-col items-center gap-1.5 rounded-[2px] text-brand-cream-50 [@media(max-height:700px)]:gap-1";
const railRing =
  "flex h-[50px] w-[50px] items-center justify-center rounded-full [@media(max-height:700px)]:h-11 [@media(max-height:700px)]:w-11";
/** The smaller round controls (Call, the eye). */
const railSmall =
  "flex h-11 w-11 items-center justify-center rounded-full [@media(max-height:700px)]:h-10 [@media(max-height:700px)]:w-10";
/** Text under Call and the eye: hidden on short screens. */
const railLabelOptional = "[@media(max-height:700px)]:hidden";
const railQuiet = "border border-brand-cream-50/25 bg-[rgba(20,20,18,0.45)]";
const railLabel = "text-[11px] font-medium tracking-[0.06em] [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]";

// Bottom offsets clear of the phone's gesture bar / browser toolbar: the
// safe-area inset or at least 12px. The swipe hint sits there on every look;
// the caption and rail sit above it.
const hintBottom = "bottom-[max(env(safe-area-inset-bottom),12px)]";
const railBottom = "bottom-[calc(max(env(safe-area-inset-bottom),12px)_+_40px)]";
const captionBottom = "bottom-[calc(max(env(safe-area-inset-bottom),12px)_+_38px)]";
// ZP-543 info view: the panel reaches the bottom edge; its content ends above the swipe hint.
const infoPanelBottom = "pb-[calc(max(env(safe-area-inset-bottom),12px)_+_38px)]";
// Touch tablets in landscape fill the screen: the panel's gradient spans it, its content
// keeps to a 640px column in the middle, under the photo (shown whole in the middle).
const infoPanelWide = "tablet:landscape:px-[max(16px,calc((100%-640px)/2))]";
/** The panel's two buttons: at least 48px (44px on short screens) tall. */
const infoButton =
  "sf-focus flex min-h-12 items-center justify-center gap-2 rounded-[2px] px-3 text-center text-[14px] font-medium leading-tight [@media(max-height:700px)]:min-h-11";
const infoTagTone: Record<InfoAvailability["kind"], string> = {
  "in-stock": "border border-brand-cream-50/70 text-brand-cream-50",
  "few-left": "bg-brand-lime text-brand-ink",
  "sold-out": "bg-brand-cream-50 text-brand-ink",
  "pre-order": "bg-brand-lime text-brand-ink",
};
/** The round Share / Call buttons above the panel: 44px on every screen (touch target). */
const infoRound = "flex h-11 w-11 items-center justify-center rounded-full";
const CLEAN_ONLY: readonly FeedView[] = ["clean"];
// ZP-1018 info view, photo mode: labels over the bare photo get a heavier
// shadow (no scrim there), and the "Show details" pill its own dark fill.
const infoLabel = "text-[11px] font-medium tracking-[0.06em] [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_8px_rgba(0,0,0,0.65)]";
const infoPill =
  "sf-focus absolute left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-brand-cream-50/45! bg-[rgba(20,20,18,0.74)] px-5 text-[13px] font-medium tracking-[0.04em] text-brand-cream-50 shadow-[0_2px_10px_rgba(0,0,0,0.3)]";
/** The panel's dark gradient (at least 86% ink behind its text) down to the bottom edge. */
const infoPanelBg =
  "bg-[linear-gradient(rgba(20,20,18,0)_0px,rgba(20,20,18,0.86)_36px,rgba(20,20,18,0.92)_100%)] [@media(max-height:700px)]:bg-[linear-gradient(rgba(20,20,18,0)_0px,rgba(20,20,18,0.86)_28px,rgba(20,20,18,0.92)_100%)]";

// The previous / next photo pills, beside the progress bars (top 68px), clear of the rail.
const photoArrow =
  "sf-focus absolute top-[82px] z-[1] flex h-9 w-9 items-center justify-center rounded-full border border-brand-cream-50/30 bg-[rgba(20,20,18,0.5)] text-brand-cream-50";

type FeedSlideProps = {
  item: FeedItem;
  index: number;
  total: number;
  /**
   * The first photo: "high" (first slide, the LCP: eager + fetchpriority
   * high), "eager" (second slide, ready for the first flick), else "lazy".
   */
  priority: "high" | "eager" | "lazy";
  /**
   * This slide's index minus the current slide's (a video preloads metadata
   * on the next slide only). Null until the current slide is known.
   */
  slideOffset: number | null;
  /**
   * ZP-543: the feed views to render: the one in effect, or (server render of
   * an A/B test, until hydration) both, each marked for CSS (`.sf-view-*`).
   * Clean is today's slide; info (ZP-1018) opens on the whole photo with
   * WhatsApp / Call and a "Show details" pill, and shows its panel on demand
   * instead of the caption, the rail and the eye.
   */
  views?: readonly FeedView[];
  /** Clean view: caption and rail shown ("Show details"); otherwise photos only. */
  details: boolean;
  onToggleDetails: () => void;
  visitHref: string;
  /** Remember this slide before the visitor leaves for its product page. */
  onLeave: (slug: string) => void;
  /** ZP-493: the feed tab ("new" or a category slug), sent with this look's events. */
  collection: string;
  /** ZP-510: tel: link of the shop's phone (Call on the rail), or null (hidden). */
  callHref: string | null;
  /**
   * ZP-510: a plain tap on any link to this look's product page (photo,
   * caption, Details) opens the details sheet instead; `opener` gets the
   * focus back when it closes. Other clicks (new tab) keep the link.
   */
  onOpenDetails: (slug: string, opener: HTMLElement) => void;
  /** ZP-510: this look's details sheet is open (its playing video pauses until it closes). */
  sheetOpen: boolean;
  /** ZP-512: owner preview of an unpublished piece (no heart: the piece is not public yet). */
  preview?: boolean;
  /** ZP-516: run the first-visit photo tour on this look (a look with one photo waits for the next). */
  tour?: boolean;
  /** ZP-516: the tour finished or the visitor stopped it. */
  onTourEnd?: () => void;
};

/**
 * One look: its photos side by side (swipe sideways, thin progress bars just
 * under the top bar; ZP-502: the video, if any, first, see FeedVideo) and, at the bottom right, the "Show details" eye.
 *
 * Clean view (the default): the clothes, the WhatsApp button (or Visit us),
 * the heart and the eye. With details: a light bottom
 * scrim, a slim caption (one-line serif name, price, rating, tag, "Tap for
 * details"; the caption links to the product page) and Share and Details on
 * top of the rail (railItems). "Swipe up for the next look" and the photo
 * arrows show on every look. Every way into the product page is
 * a real <a href>. In clean view the first photo link is in the tab order,
 * named "<name>, <price>[, <tag>]. View details" (photoLinkLabel), and an
 * sr-only <h2> keeps the look's heading.
 */
export function FeedSlide({
  item,
  index,
  total,
  priority,
  slideOffset,
  views = CLEAN_ONLY,
  details,
  onToggleDetails,
  visitHref,
  onLeave,
  collection,
  callHref,
  onOpenDetails,
  sheetOpen,
  preview = false,
  tour = false,
  onTourEnd,
}: FeedSlideProps) {
  const strip = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState(0);
  const { status, share } = useShare();
  // ZP-502: the video (if any) first, then the photos; the progress bars count it.
  const media = mediaItems(item.images, item.video);
  const count = media.length;

  const article = useRef<HTMLElement>(null);
  const touring = tour && count > 1;
  // After the tour, the photo on screen is still the tour's until the visitor
  // scrolls the strip or leaves the look: its views must not count as theirs.
  const [afterTour, setAfterTour] = useState(false);
  const tourEndedAt = useRef(0);

  // ZP-1018: the info view's mode for this look (photo / details / slim,
  // feed-view.ts). Every look opens in photo mode and starts there again once
  // it has left the screen (the observer below).
  const [infoMode, setInfoMode] = useState<InfoMode>(INFO_MODE_START);
  // The tour runs in photo mode: a replay over a look with its panel open closes it.
  const [touringSeen, setTouringSeen] = useState(touring);
  if (touring !== touringSeen) {
    setTouringSeen(touring);
    if (touring) setInfoMode(nextInfoMode(infoMode, "tour-start"));
  }
  const infoHeadingId = useId();
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const infoPillRef = useRef<HTMLButtonElement>(null);
  const infoSlimRef = useRef<HTMLButtonElement>(null);
  /** The photo the strip last came to rest on (a drag that snaps back changes nothing). */
  const settledPhoto = useRef(0);
  /** Where focus goes once the mode the visitor asked for has rendered. */
  const infoFocus = useRef<"panel" | "pill" | "slim" | null>(null);
  useEffect(() => {
    const target = infoFocus.current;
    if (!target) return;
    infoFocus.current = null;
    const el = target === "panel" ? infoPanelRef.current : target === "pill" ? infoPillRef.current : infoSlimRef.current;
    el?.focus({ preventScroll: true });
  }, [infoMode]);

  // ZP-516: the first-visit tour. Slides through every photo, then back to the
  // first. Any touch, click, scroll or key stops it where it is (ending the
  // tour turns `touring` off, which clears the timer and the listeners).
  useEffect(() => {
    const el = strip.current;
    if (!touring || !el) return;
    const end = () => {
      tourEndedAt.current = Date.now();
      setAfterTour(true);
      onTourEnd?.();
    };
    const dwell = tourPhotoMs(count);
    let next = 1;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
      if (next === 0) {
        timer = setTimeout(end, dwell);
      } else {
        next = next + 1 < count ? next + 1 : 0;
        timer = setTimeout(step, dwell);
      }
    };
    timer = setTimeout(step, dwell);
    const inputs = ["pointerdown", "touchstart", "wheel", "keydown"] as const;
    inputs.forEach((type) => window.addEventListener(type, end, { capture: true, passive: true }));
    return () => {
      clearTimeout(timer);
      inputs.forEach((type) => window.removeEventListener(type, end, true));
    };
  }, [touring, count, onTourEnd]);

  // Once the look is fully off screen (not at the halfway point of a swipe,
  // and never for a swipe that snaps back), it goes back to its first photo,
  // so coming back always starts on photo 1. Instant: nobody sees it.
  useEffect(() => {
    const el = article.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting || entry.intersectionRatio > 0) continue;
        if (strip.current && strip.current.scrollLeft !== 0) strip.current.scrollLeft = 0;
        setPhoto(0);
        setAfterTour(false);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ZP-1018: once this look has left the screen, its next visit opens on the
  // whole photo again (info view only). Its own observer: a look snapped just
  // off screen still touches the viewport's edge (isIntersecting, ratio 0), so
  // "gone" here is under 1% visible, never at the halfway point of a swipe.
  const infoView = views.includes("info");
  useEffect(() => {
    const el = article.current;
    if (!infoView || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.intersectionRatio < 0.01)) return;
        // Review: the reset removes the panel's controls; focus inside them would drop to
        // <body> and the arrow keys would stop reaching the feed, so hand it to the feed first.
        if (el.contains(document.activeElement) && document.activeElement !== el) {
          el.closest<HTMLElement>('[role="region"]')?.focus({ preventScroll: true });
        }
        setInfoMode((mode) => nextInfoMode(mode, "leave-look"));
      },
      { threshold: [0, 0.01] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [infoView]);

  const onStripScroll = () => {
    const el = strip.current;
    if (!el) return;
    const width = Math.max(1, el.clientWidth);
    const i = Math.round(el.scrollLeft / width);
    if (i !== photo) setPhoto(i);
    // ZP-1018: the visitor's own move to another photo shrinks the info panel to
    // its slim line (never the tour's, nor its smooth scroll settling). Only once
    // the strip has settled on that photo: a drag past halfway that snaps back is
    // no move (review).
    const settled = Math.abs(el.scrollLeft - i * width) < 2;
    if (settled && i !== settledPhoto.current) {
      settledPhoto.current = i;
      const sinceTourEndMs = Date.now() - tourEndedAt.current;
      if (infoMode === "details" && isVisitorPhotoChange({ touring, afterTour, sinceTourEndMs, settleMs: TOUR_SETTLE_MS })) {
        // Focus inside the panel (keyboard) moves to the slim line rather than being lost.
        if (infoPanelRef.current?.contains(document.activeElement)) infoFocus.current = "slim";
        setInfoMode((mode) => nextInfoMode(mode, "photo-swipe"));
      }
    }
    if (afterTour && Date.now() - tourEndedAt.current > TOUR_SETTLE_MS) setAfterTour(false);
  };
  const stepPhoto = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: (photo + dir) * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };
  const leave = () => onLeave(item.slug);
  const nav = photoNav(photo, count);
  // ZP-543: which views to render; with both (A/B before hydration) CSS shows one.
  const showClean = views.includes("clean");
  const showInfo = views.includes("info");
  const both = showClean && showInfo;
  const cleanClass = both ? "sf-view-clean" : undefined;
  const infoClass = both ? "sf-view-info" : undefined;
  const infoOnly = showInfo && !showClean;
  const availability = infoAvailability(item);
  const primary = infoPrimary(item);
  const rail = railItems({ details, enquire: item.enquireHref !== null, share: item.shareUrl !== null, call: callHref !== null }).filter(
    (kind) => !(preview && kind === "love"),
  );

  // ZP-510: while the details sheet is open over this look, its playing video
  // pauses; it resumes when the sheet closes (if it was playing).
  useEffect(() => {
    if (!sheetOpen) return;
    const video = article.current?.querySelector("video");
    if (!video || video.paused) return;
    video.pause();
    return () => {
      if (video.isConnected) void video.play().catch(() => {});
    };
  }, [sheetOpen]);

  // ZP-510: every product-page link of this look (the photos, the video, the
  // caption, Details) opens the details sheet on a plain tap. Captured here,
  // before the link's own handlers (Next's navigation, onLeave), which then do not run.
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!isPlainClick(event)) return;
    const link = (event.target as Element).closest("a");
    if (!link || !event.currentTarget.contains(link) || link.getAttribute("href") !== item.href) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenDetails(item.slug, link);
  };

  // ZP-493 analytics (docs/storefront/analytics.md). No scroll handlers: the
  // current slide comes from the feed, dwell from IntersectionObserver.
  const { slug } = item;
  const isCurrent = slideOffset === 0;
  useEffect(() => {
    if (isCurrent) track("look_view", { slug, collection, position: index });
  }, [isCurrent, slug, collection, index]);
  // `page`: where the dwell started (it may end after a navigation to the product page).
  // ZP-516: the tour is not the visitor's own attention or swiping, so it is not counted (the ranking reads both).
  useDwell(article, (seconds, page) => track("look_dwell", { slug, collection, seconds, page }), { key: slug, enabled: !touring });
  // The photo on screen (null while the video item shows): 1-based among the photos.
  const current = media[photo];
  const shownPhoto = isCurrent && !touring && !afterTour && current?.kind === "image" ? photoProps(item.images, current.imageIndex) : null;
  const shownKey = shownPhoto ? `${slug}-${shownPhoto.index}` : null;
  useEffect(() => {
    if (shownPhoto) track("photo_view", { slug, collection, ...shownPhoto });
    // Once per photo shown (shownKey), not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);
  useActiveDwell(
    shownPhoto !== null,
    (seconds, page) => {
      if (shownPhoto) track("photo_dwell", { slug, collection, ...shownPhoto, seconds, page });
    },
    shownKey,
  );
  const enquire = () => {
    const e = enquiryEvent({ soldOut: item.soldOut, screen: "feed" });
    track(e.type, { slug, collection, ...e.props });
  };
  /** ZP-1018: Show details / Hide details / the slim line; the same details events as clean view's eye. */
  const changeInfo = (event: InfoModeEvent, focus: "panel" | "pill") => {
    const sent = infoModeTrack(infoMode, event);
    if (sent) track(sent, { slug, collection });
    infoFocus.current = focus;
    setInfoMode(nextInfoMode(infoMode, event));
  };
  const onShare = async () => {
    const outcome = await share(item.shareUrl as string, `${item.name} – VYRA`);
    if (outcome === "native" || outcome === "copy") track("share", { slug, collection, method: outcome, screen: "feed" });
  };

  return (
    // An <article> (not a region landmark) named after the look.
    <article
      ref={article}
      id={lookAnchorId(item.slug)}
      aria-label={item.name}
      // ZP-513: focusable by script only (the feed moves focus here after "You may also like").
      tabIndex={-1}
      data-feed-slide={index}
      onClickCapture={onClickCapture}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-[#2a2a26]"
    >
      <span className="sr-only">
        Look {index + 1} of {total}
      </span>
      <div
        ref={strip}
        onScroll={onStripScroll}
        className="sf-scroll-x absolute inset-0 flex snap-x snap-mandatory overscroll-x-contain"
      >
        {media.map((entryItem, i) => {
          // Clean view: the first item (video or photo) is the keyboard / screen reader way in.
          // ZP-543: the info view's panel is the way in there.
          const entry = i === 0 && !details && !infoOnly;
          if (entryItem.kind === "video") {
            return (
              <FeedVideo
                key={`video-${entryItem.video.src}`}
                video={entryItem.video}
                name={item.name}
                href={item.href}
                onLeave={leave}
                linkTabIndex={entry ? 0 : -1}
                linkLabel={entry ? photoLinkLabel(item) : `${item.name}, video`}
                priority={priority}
                slideOffset={slideOffset}
                sizes={SLIDE_SIZES}
                slug={item.slug}
                collection={collection}
              />
            );
          }
          const image = entryItem.image;
          return (
            <Link
              key={`${image.src}-${entryItem.imageIndex}`}
              href={item.href}
              onClick={leave}
              aria-haspopup="dialog"
              tabIndex={entry ? 0 : -1}
              aria-label={
                entry
                  ? photoLinkLabel(item)
                  : image.alt.trim()
                    ? undefined
                    : `${item.name}, photo ${entryItem.imageIndex + 1} of ${item.images.length}`
              }
              className="sf-focus relative block h-full w-full flex-none snap-start focus-visible:outline-offset-[-4px]"
            >
              <ImageFallback />
              <FeedPhoto
                image={{ src: image.src, srcSet: image.srcSet || undefined, alt: image.alt }}
                // The first item of the strip only (with a video first, its poster is the eager one).
                eager={priority !== "lazy" && i === 0}
                highPriority={priority === "high"}
                sizes={SLIDE_SIZES}
              />
            </Link>
          );
        })}
      </div>

      {/* Top scrim behind the slim top bar (menu, wordmark, collection pill). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[130px] bg-[linear-gradient(rgba(20,20,18,0.5),rgba(20,20,18,0))]"
      />

      {count > 1 ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[68px] flex justify-center gap-[5px]">
            {media.map((m, i) => (
              <span
                key={`${m.kind === "video" ? m.video.src : m.image.src}-bar-${i}`}
                className={cn("h-[3px] w-[26px] rounded-[2px]", i === photo ? "bg-brand-cream-50" : "bg-brand-cream-50/40")}
              />
            ))}
          </div>
          {/* Previous / next photo (all devices; swiping stays the main gesture): beside the
              progress bars at the top, never under the rail. Only when there is one to go to. */}
          {nav.prev ? (
            <button
              type="button"
              onClick={() => stepPhoto(-1)}
              aria-label="Previous photo"
              className={cn(photoArrow, "left-3")}
            >
              <ChevronIcon direction="left" className="h-[18px] w-[18px]" />
            </button>
          ) : null}
          {nav.next ? (
            <button
              type="button"
              onClick={() => stepPhoto(1)}
              aria-label="Next photo"
              className={cn(photoArrow, "right-3")}
            >
              <ChevronIcon direction="right" className="h-[18px] w-[18px]" />
            </button>
          ) : null}
        </>
      ) : null}

      {/* Clean view: the look keeps its heading for screen readers. */}
      {showClean && !details ? <h2 className={cn("sr-only", cleanClass)}>{item.name}</h2> : null}

      {showClean && details ? (
        <>
          {/* Light bottom scrim: at least 62% ink behind the caption lines, plus a text shadow. */}
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-[190px] bg-[linear-gradient(rgba(20,20,18,0)_0%,rgba(20,20,18,0.62)_45%,rgba(20,20,18,0.72)_100%)]",
              cleanClass,
            )}
          />
          <Link
            href={item.href}
            onClick={leave}
            aria-haspopup="dialog"
            className={cn(
              "sf-focus absolute left-4 right-[84px] flex flex-col gap-[3px] rounded-[2px] p-1 text-brand-cream-50 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]",
              // Clear of the first-slide swipe hint while it shows.
              captionBottom,
              cleanClass,
            )}
          >
            <h2 className="m-0 truncate font-serif text-[21px] font-semibold leading-[1.15]">{item.name}</h2>
            <span className="flex items-center gap-2 text-sm font-medium">
              {item.price}
              {/* ZP-508: only with at least one approved review. */}
              {item.rating ? (
                <span className="text-[13px] font-medium">
                  <span aria-hidden="true">{item.rating.text}</span>
                  <span className="sr-only">{item.rating.label}</span>
                </span>
              ) : null}
              {item.badge ? (
                <span
                  className={cn(
                    "rounded-[2px] px-1.5 py-[3px] text-[9px] font-semibold uppercase leading-none tracking-[0.16em] [text-shadow:none]",
                    badgeTone[item.badge.kind],
                  )}
                >
                  {item.badge.label}
                </span>
              ) : null}
              <span aria-hidden="true" className="text-xs font-normal tracking-[0.04em] text-brand-cream-50/85">
                · Tap for details
              </span>
            </span>
          </Link>
        </>
      ) : null}

      {/* The rail, top to bottom (railItems): [Share, Details: with details only], WhatsApp
          (or Visit us), the heart, the eye. The WhatsApp button, the heart and
          the eye float in clean view too; the eye stays at the bottom and never moves. */}
      {showClean ? (
        <div className={cn("absolute right-3 flex flex-col items-center gap-3.5 [@media(max-height:700px)]:gap-2", railBottom, cleanClass)}>
          {rail.map((kind) => {
            switch (kind) {
              case "share":
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => void onShare()}
                    className={railItem}
                    aria-label={`Share the ${item.name}`}
                  >
                    <span className={cn(railRing, railQuiet)}>
                      <ShareIcon className="h-[22px] w-[22px]" />
                    </span>
                    <span className={railLabel}>Share</span>
                  </button>
                );
              case "details":
                return (
                  <Link
                    key={kind}
                    href={item.href}
                    onClick={leave}
                    className={railItem}
                    aria-haspopup="dialog"
                    aria-label={`Details of the ${item.name}`}
                  >
                    <span className={cn(railRing, railQuiet)}>
                      <DetailsIcon className="h-[22px] w-[22px]" />
                    </span>
                    <span className={railLabel}>Details</span>
                  </Link>
                );
              case "enquire":
                return (
                  <a
                    key={kind}
                    href={item.enquireHref as string}
                    onClick={enquire}
                    className={railItem}
                    aria-label={item.soldOut ? `Ask about a restock of the ${item.name} on WhatsApp` : `Enquire about the ${item.name} on WhatsApp`}
                  >
                    {/* The official WhatsApp logo: white on WhatsApp green (#25D366). A plain link, no target. */}
                    <span className={cn(railRing, "bg-[#25D366] text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]")}>
                      <WhatsAppLogoIcon className="h-7 w-7" />
                    </span>
                    <span className={railLabel}>WhatsApp</span>
                  </a>
                );
              case "call":
                return (
                  <a
                    key={kind}
                    href={callHref as string}
                    onClick={() => track("call", { slug, collection, screen: "feed" })}
                    className={railItem}
                    aria-label="Call VYRA"
                  >
                    <span className={cn(railSmall, railQuiet)}>
                      <PhoneIcon className="h-5 w-5" />
                    </span>
                    <span className={cn(railLabel, railLabelOptional)}>Call</span>
                  </a>
                );
              case "visit":
                return (
                  <Link key={kind} href={visitHref} onClick={() => track("visit_us", { screen: "feed" })} className={railItem}>
                    <span className={cn(railRing, "border border-brand-olive bg-brand-olive")}>
                      <PinIcon className="h-6 w-6" />
                    </span>
                    <span className={railLabel}>Visit us</span>
                  </Link>
                );
              case "love":
                return (
                  <LoveButton
                    key={kind}
                    slug={slug}
                    name={item.name}
                    loves={item.loves}
                    variant="rail"
                    className="[@media(max-height:700px)]:gap-1"
                  />
                );
              case "eye":
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={onToggleDetails}
                    // One fixed name; aria-pressed says whether details are shown.
                    aria-pressed={details}
                    aria-label="Show details"
                    className={railItem}
                  >
                    <span className={cn(railSmall, railQuiet)}>
                      <EyeIcon className="h-5 w-5" />
                    </span>
                    <span className={cn(railLabel, railLabelOptional)}>{details ? "Hide" : "Show details"}</span>
                  </button>
                );
            }
          })}
        </div>
      ) : null}

      {/* ZP-1018: the info view in photo mode (how every look opens): the whole photo, no
          panel and no bottom gradient; WhatsApp (or Visit us) and Call at the right, the
          "Show details" pill at the bottom centre. The server renders this mode. */}
      {showInfo && infoMode === "photo" ? (
        <>
          <h2 className={cn("sr-only", infoClass)}>{item.name}</h2>
          <div className={cn("absolute right-3 flex flex-col items-center gap-3.5 [@media(max-height:700px)]:gap-2", railBottom, infoClass)}>
            {infoPhotoRail({ enquire: item.enquireHref !== null, call: callHref !== null }).map((kind) => {
              switch (kind) {
                case "enquire":
                  return (
                    <a
                      key={kind}
                      href={item.enquireHref as string}
                      onClick={enquire}
                      className={railItem}
                      aria-label={item.soldOut ? `Ask about a restock of the ${item.name} on WhatsApp` : `Enquire about the ${item.name} on WhatsApp`}
                    >
                      {/* The official WhatsApp logo: white on WhatsApp green (#25D366), as in clean view. */}
                      <span className={cn(railRing, "bg-[#25D366] text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]")}>
                        <WhatsAppLogoIcon className="h-7 w-7" />
                      </span>
                      <span className={infoLabel}>WhatsApp</span>
                    </a>
                  );
                case "visit":
                  return (
                    <Link key={kind} href={visitHref} onClick={() => track("visit_us", { screen: "feed" })} className={railItem}>
                      <span className={cn(railRing, "border border-brand-olive bg-brand-olive")}>
                        <PinIcon className="h-6 w-6" />
                      </span>
                      <span className={infoLabel}>Visit us</span>
                    </Link>
                  );
                case "call":
                  return (
                    <a
                      key={kind}
                      href={callHref as string}
                      onClick={() => track("call", { slug, collection, screen: "feed" })}
                      className={railItem}
                      aria-label="Call VYRA"
                    >
                      <span className={cn(railSmall, railQuiet)}>
                        <PhoneIcon className="h-5 w-5" />
                      </span>
                      <span className={cn(infoLabel, railLabelOptional)}>Call</span>
                    </a>
                  );
              }
            })}
          </div>
          <button
            ref={infoPillRef}
            type="button"
            onClick={() => changeInfo("show", "panel")}
            aria-expanded={false}
            className={cn(infoPill, railBottom, infoClass)}
          >
            <ChevronIcon direction="up" className="h-4 w-4 shrink-0" />
            Show details
          </button>
        </>
      ) : null}

      {/* ZP-1018: details mode (after Show details): Hide details, the heart, share and Call
          stacked at the right, then the ZP-543 panel on a dark gradient (>= 86% ink behind its
          text) down to the bottom edge, where the swipe hint sits on top of it. A swipe to
          another photo shrinks the panel to one slim line; tapping it brings it back. */}
      {showInfo && infoMode !== "photo" ? (
        <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 flex flex-col", infoClass)}>
          <div className="sf-panel-fade pointer-events-auto mb-2 mr-3 flex flex-col items-center gap-3 self-end [@media(max-height:700px)]:gap-2">
            <button type="button" onClick={() => changeInfo("hide", "pill")} aria-expanded={true} className={railItem}>
              <span className={cn(infoRound, railQuiet)}>
                <CornersIcon className="h-5 w-5" />
              </span>
              <span className={infoLabel}>Hide details</span>
            </button>
            {infoActions({ share: item.shareUrl !== null, call: callHref !== null, preview }).map((kind) => {
              switch (kind) {
                case "love":
                  return (
                    <LoveButton key={kind} slug={slug} name={item.name} loves={item.loves} variant="rail" className="[@media(max-height:700px)]:gap-1" />
                  );
                case "share":
                  return (
                    <button key={kind} type="button" onClick={() => void onShare()} className={railItem} aria-label={`Share the ${item.name}`}>
                      <span className={cn(infoRound, railQuiet)}>
                        <ShareIcon className="h-5 w-5" />
                      </span>
                      <span className={cn(railLabel, railLabelOptional)}>Share</span>
                    </button>
                  );
                case "call":
                  return (
                    <a
                      key={kind}
                      href={callHref as string}
                      onClick={() => track("call", { slug, collection, screen: "feed" })}
                      className={railItem}
                      aria-label="Call VYRA"
                    >
                      <span className={cn(infoRound, railQuiet)}>
                        <PhoneIcon className="h-5 w-5" />
                      </span>
                      <span className={cn(railLabel, railLabelOptional)}>Call</span>
                    </a>
                  );
              }
            })}
          </div>
          {infoMode === "slim" ? (
            // The slim line: the name (one line), "Ask for price · tap for more" (a button that
            // brings the full panel back) and a round WhatsApp button (Visit us without a number).
            <div className={cn("pointer-events-auto flex items-center gap-3 px-4 pt-7 text-brand-cream-50", infoPanelBg, infoPanelBottom, infoPanelWide)}>
              <h2 className="sr-only">{item.name}</h2>
              <button
                ref={infoSlimRef}
                type="button"
                onClick={() => changeInfo("expand", "panel")}
                aria-expanded={false}
                className="sf-focus flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-[2px] text-left"
              >
                <span className="block w-full truncate font-serif text-[18px] font-semibold leading-tight">{item.name}</span>
                <span className="text-[13px] font-medium text-brand-cream-50/90">{infoSlimLine(item.price)}</span>
              </button>
              {primary.kind === "visit" ? (
                <Link
                  href={visitHref}
                  onClick={() => track("visit_us", { screen: "feed" })}
                  aria-label="Visit us"
                  className={cn("sf-focus shrink-0 rounded-full", infoRound, "bg-brand-olive text-white")}
                >
                  <PinIcon className="h-5 w-5" />
                </Link>
              ) : (
                <a
                  href={item.enquireHref as string}
                  onClick={enquire}
                  aria-label={item.soldOut ? `Ask about a restock of the ${item.name} on WhatsApp` : `Ask the price of the ${item.name} on WhatsApp`}
                  className={cn("sf-focus shrink-0 rounded-full", infoRound, "bg-[#25D366] text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]")}
                >
                  <WhatsAppLogoIcon className="h-6 w-6" />
                </a>
              )}
            </div>
          ) : (
          <div
            ref={infoPanelRef}
            role="group"
            aria-labelledby={infoHeadingId}
            tabIndex={-1}
            className={cn("sf-panel-up pointer-events-auto px-4 pt-9 text-brand-cream-50 outline-none [@media(max-height:700px)]:pt-7", infoPanelBg, infoPanelBottom, infoPanelWide)}
          >
            <span
              className={cn(
                "inline-block rounded-[2px] px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.16em]",
                infoTagTone[availability.kind],
              )}
            >
              {availability.label}
            </span>
            {/* The look's heading in this view. */}
            <h2 id={infoHeadingId} className="m-0 mt-2 line-clamp-2 font-serif text-[25px] font-semibold leading-[1.12] [@media(max-height:700px)]:mt-1.5 [@media(max-height:700px)]:line-clamp-1 [@media(max-height:700px)]:text-[22px]">
              {item.name}
            </h2>
            <p className="m-0 mt-1 flex items-center gap-2 text-[15px] font-medium">
              {infoPrice(item.price)}
              {item.rating ? (
                <span className="text-[13px] font-medium text-brand-cream-50/90">
                  <span aria-hidden="true">{item.rating.text}</span>
                  <span className="sr-only">{item.rating.label}</span>
                </span>
              ) : null}
            </p>
            <div className="mt-3 flex flex-col gap-2 min-[400px]:flex-row [@media(max-height:700px)]:mt-2.5">
              {primary.kind === "visit" ? (
                <Link
                  href={visitHref}
                  onClick={() => track("visit_us", { screen: "feed" })}
                  className={cn(infoButton, "flex-[1.15] bg-brand-olive text-white hover:bg-brand-olive-700")}
                >
                  <PinIcon className="h-[18px] w-[18px] shrink-0" />
                  {primary.label}
                </Link>
              ) : (
                <a
                  href={item.enquireHref as string}
                  onClick={enquire}
                  className={cn(infoButton, "flex-[1.15] bg-brand-olive text-white hover:bg-brand-olive-700")}
                >
                  <WhatsAppLogoIcon className="h-[18px] w-[18px] shrink-0" />
                  {primary.label}
                  <span className="sr-only">: {item.name}</span>
                </a>
              )}
              <Link
                href={item.href}
                onClick={leave}
                aria-haspopup="dialog"
                className={cn(infoButton, "flex-1 border border-brand-cream-50/70! text-brand-cream-50 hover:bg-brand-cream-50/10")}
              >
                View sizes &amp; details
                <span className="sr-only">: {item.name}</span>
              </Link>
            </div>
          </div>
          )}
        </div>
      ) : null}

      {/* "Swipe up for the next look" on every look, always (owner): small and quiet, over
          the gesture bar / toolbar inset, below the caption and the rail. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 flex flex-col items-center text-brand-cream-50/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.75)]",
          hintBottom,
        )}
      >
        <ChevronIcon direction="up" className="h-4 w-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em]">Swipe up for the next look</span>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={cn(
          "absolute inset-x-5 bottom-24 z-10 rounded-[2px] bg-brand-ink px-4 py-3 text-[13px] leading-normal text-brand-cream-50 shadow-[0_8px_24px_rgba(0,0,0,0.25)]",
          status === "idle" && "sr-only",
        )}
      >
        {status === "copied" ? "Link copied. Paste it anywhere to share." : status === "failed" ? `Copy this link: ${item.shareUrl}` : ""}
      </p>
    </article>
  );
}
