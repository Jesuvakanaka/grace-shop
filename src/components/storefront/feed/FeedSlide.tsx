"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { track, useActiveDwell, useDwell } from "@/lib/analytics/client";
import { lookAnchorId, photoLinkLabel, type FeedBadge, type FeedItem } from "@/lib/storefront/feed";
import { mediaItems } from "@/lib/storefront/feed-media";
import { photoProps } from "@/lib/storefront/tracking";
import { cn } from "../cn";
import { LoveButton } from "../loves/LoveButton";
import { useShare } from "../product/useShare";
import { ImageFallback, StorefrontImg } from "../StorefrontImage";
import { FeedVideo } from "../video/FeedVideo";
import { ChevronIcon, DetailsIcon, EnquireIcon, EyeIcon, PinIcon, ShareIcon } from "./feed-icons";

/** Phones: the full width; computers: the phone-shaped column (about 9/16 of the viewport height). */
const SLIDE_SIZES = "(min-width: 768px) 57vh, 100vw";

const badgeTone: Record<FeedBadge["kind"], string> = {
  "sold-out": "bg-brand-cream-50 text-brand-ink",
  "few-left": "bg-brand-lime text-brand-ink",
  new: "border border-brand-cream-50/70 bg-brand-cream-50/20 text-brand-cream-50",
};

// The rail: round controls with a small label under them.
const railItem = "sf-focus flex flex-col items-center gap-1.5 rounded-[2px] text-brand-cream-50";
const railRing = "flex h-[50px] w-[50px] items-center justify-center rounded-full";
const railQuiet = "border border-brand-cream-50/25 bg-[rgba(20,20,18,0.45)]";
const railLabel = "text-[11px] font-medium tracking-[0.06em] [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]";

type FeedSlideProps = {
  item: FeedItem;
  index: number;
  total: number;
  /** The first-slide swipe hint is showing: lift the caption and rail clear of it. */
  lifted: boolean;
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
  /** Caption and rail shown ("Show details"); otherwise the clean view (photos only). */
  details: boolean;
  onToggleDetails: () => void;
  visitHref: string;
  /** Remember this slide before the visitor leaves for its product page. */
  onLeave: (slug: string) => void;
  /** ZP-493: the feed tab ("new" or a category slug), sent with this look's events. */
  collection: string;
};

/**
 * One look: its photos side by side (swipe sideways, thin progress bars just
 * under the top bar; ZP-502: the video, if any, first, see FeedVideo) and, at the bottom right, the "Show details" eye.
 *
 * Clean view (the default): the clothes alone. With details: a light bottom
 * scrim, a slim caption (one-line serif name, price, tag, "Tap for details";
 * the caption links to the product page) and the rail (Enquire / Restock on
 * WhatsApp or Visit us, Share, Details). Every way into the product page is
 * a real <a href>. In clean view the first photo link is in the tab order,
 * named "<name>, <price>[, <tag>]. View details" (photoLinkLabel), and an
 * sr-only <h2> keeps the look's heading.
 */
export function FeedSlide({
  item,
  index,
  total,
  lifted,
  priority,
  slideOffset,
  details,
  onToggleDetails,
  visitHref,
  onLeave,
  collection,
}: FeedSlideProps) {
  const strip = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState(0);
  const { status, share } = useShare();
  // ZP-502: the video (if any) first, then the photos; the progress bars count it.
  const media = mediaItems(item.images, item.video);
  const count = media.length;

  const article = useRef<HTMLElement>(null);

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
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onStripScroll = () => {
    const el = strip.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== photo) setPhoto(i);
  };
  const stepPhoto = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: (photo + dir) * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };
  const leave = () => onLeave(item.slug);

  // ZP-493 analytics (docs/storefront/analytics.md). No scroll handlers: the
  // current slide comes from the feed, dwell from IntersectionObserver.
  const { slug } = item;
  const isCurrent = slideOffset === 0;
  useEffect(() => {
    if (isCurrent) track("look_view", { slug, collection, position: index });
  }, [isCurrent, slug, collection, index]);
  useDwell(article, (seconds) => track("look_dwell", { slug, collection, seconds }), { key: slug });
  // The photo on screen (null while the video item shows): 1-based among the photos.
  const current = media[photo];
  const shownPhoto = isCurrent && current?.kind === "image" ? photoProps(item.images, current.imageIndex) : null;
  const shownKey = shownPhoto ? `${slug}-${shownPhoto.index}` : null;
  useEffect(() => {
    if (shownPhoto) track("photo_view", { slug, collection, ...shownPhoto });
    // Once per photo shown (shownKey), not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);
  useActiveDwell(
    shownPhoto !== null,
    (seconds) => {
      if (shownPhoto) track("photo_dwell", { slug, collection, ...shownPhoto, seconds });
    },
    shownKey,
  );
  const enquire = () =>
    track(item.soldOut ? "restock_request" : "whatsapp_enquire", { slug, collection, screen: "feed" });
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
      data-feed-slide={index}
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
          const entry = i === 0 && !details;
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
              <StorefrontImg
                image={{ src: image.src, srcSet: image.srcSet || undefined, alt: image.alt }}
                // The first item of the strip only (with a video first, its poster is the eager one).
                eager={priority !== "lazy" && i === 0}
                highPriority={priority === "high"}
                sizes={SLIDE_SIZES}
                className="object-[50%_20%]"
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
          {/* Mouse users: step through the photos (touch and trackpads swipe). */}
          <div className="pointer-events-none absolute inset-x-2 top-1/2 hidden -translate-y-1/2 justify-between [@media(hover:hover)_and_(pointer:fine)]:flex">
            <button
              type="button"
              onClick={() => stepPhoto(-1)}
              disabled={photo === 0}
              aria-label={`Previous photo of the ${item.name}`}
              className="sf-focus pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(20,20,18,0.55)] text-brand-cream-50 transition-opacity disabled:opacity-0"
            >
              <ChevronIcon direction="left" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => stepPhoto(1)}
              disabled={photo >= count - 1}
              aria-label={`Next photo of the ${item.name}`}
              className="sf-focus pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(20,20,18,0.55)] text-brand-cream-50 transition-opacity disabled:opacity-0"
            >
              <ChevronIcon direction="right" className="h-5 w-5" />
            </button>
          </div>
        </>
      ) : null}

      {/* Clean view: the look keeps its heading for screen readers. */}
      {!details ? <h2 className="sr-only">{item.name}</h2> : null}

      {details ? (
        <>
          {/* Light bottom scrim: at least 62% ink behind the caption lines, plus a text shadow. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[190px] bg-[linear-gradient(rgba(20,20,18,0)_0%,rgba(20,20,18,0.62)_45%,rgba(20,20,18,0.72)_100%)]"
          />
          <Link
            href={item.href}
            onClick={leave}
            className={cn(
              "sf-focus absolute left-4 right-[84px] flex flex-col gap-[3px] rounded-[2px] p-1 text-brand-cream-50 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]",
              // Clear of the first-slide swipe hint while it shows.
              lifted ? "bottom-12" : "bottom-[22px]",
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

      {/* The rail, bottom up: the eye, the heart (ZP-507: both also in clean view), then with details Details, Share, Enquire. */}
      <div className={cn("absolute right-3 flex flex-col items-center gap-3.5", lifted ? "bottom-12" : "bottom-6")}>
        {details ? (
          <>
            {item.enquireHref ? (
              <a
                href={item.enquireHref}
                onClick={enquire}
                className={railItem}
                aria-label={item.soldOut ? `Ask about a restock of the ${item.name} on WhatsApp` : `Enquire about the ${item.name} on WhatsApp`}
              >
                <span className={cn(railRing, "border border-brand-olive bg-brand-olive")}>
                  <EnquireIcon className="h-6 w-6" />
                </span>
                <span className={railLabel}>{item.soldOut ? "Restock" : "Enquire"}</span>
              </a>
            ) : (
              <Link href={visitHref} onClick={() => track("visit_us", { screen: "feed" })} className={railItem}>
                <span className={cn(railRing, "border border-brand-olive bg-brand-olive")}>
                  <PinIcon className="h-6 w-6" />
                </span>
                <span className={railLabel}>Visit us</span>
              </Link>
            )}
            {item.shareUrl ? (
              <button
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
            ) : null}
            <Link href={item.href} onClick={leave} className={railItem} aria-label={`Details of the ${item.name}`}>
              <span className={cn(railRing, railQuiet)}>
                <DetailsIcon className="h-[22px] w-[22px]" />
              </span>
              <span className={railLabel}>Details</span>
            </Link>
          </>
        ) : null}
        <LoveButton slug={slug} name={item.name} loves={item.loves} variant="rail" />
        <button
          type="button"
          onClick={onToggleDetails}
          // One fixed name; aria-pressed says whether details are shown.
          aria-pressed={details}
          aria-label="Show details"
          className={railItem}
        >
          {/* data-feed-eye: the first-visit guide rings this button (FeedGuide). */}
          <span data-feed-eye="" className={cn("flex h-11 w-11 items-center justify-center rounded-full", railQuiet)}>
            <EyeIcon className="h-5 w-5" />
          </span>
          <span className={railLabel}>{details ? "Hide" : "Show details"}</span>
        </button>
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
