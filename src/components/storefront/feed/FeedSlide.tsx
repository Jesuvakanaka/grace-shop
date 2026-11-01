"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { lookAnchorId, type FeedBadge, type FeedItem } from "@/lib/storefront/feed";
import { cn } from "../cn";
import { useShare } from "../product/useShare";
import { ImageFallback, StorefrontImg } from "../StorefrontImage";
import { ArrowIcon, ChevronIcon, DetailsIcon, EnquireIcon, PinIcon, ShareIcon } from "./feed-icons";

/** Phones: the full width; computers: the phone-shaped column (about 9/16 of the viewport height). */
const SLIDE_SIZES = "(min-width: 768px) 57vh, 100vw";

const badgeTone: Record<FeedBadge["kind"], string> = {
  "sold-out": "bg-brand-cream-50 text-brand-ink",
  "few-left": "bg-brand-lime text-brand-ink",
  new: "border border-brand-cream-50/70 bg-brand-cream-50/20 text-brand-cream-50",
};

// The rail: a 50px round control with a small label under it.
const railItem = "sf-focus flex flex-col items-center gap-1.5 rounded-[2px] text-brand-cream-50";
const railRing = "flex h-[50px] w-[50px] items-center justify-center rounded-full";
const railQuiet = "border border-brand-cream-50/25 bg-[rgba(20,20,18,0.45)]";
const railLabel = "text-[11px] font-medium tracking-[0.06em] [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]";

type FeedSlideProps = {
  item: FeedItem;
  index: number;
  total: number;
  /**
   * The first photo: "high" (first slide, the LCP: eager + fetchpriority
   * high), "eager" (second slide, ready for the first flick), else "lazy".
   */
  priority: "high" | "eager" | "lazy";
  visitHref: string;
  /** Remember this slide before the visitor leaves for its product page. */
  onLeave: (slug: string) => void;
};

/**
 * One look: its photos side by side (swipe sideways, thin progress bars), a
 * scrim with the category, serif name, price and tag, "View details", and
 * the rail (Enquire / Restock on WhatsApp or Visit us, Share, Details).
 * Every way into the product page is a real <a href>.
 */
export function FeedSlide({ item, index, total, priority, visitHref, onLeave }: FeedSlideProps) {
  const strip = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState(0);
  const { status, share } = useShare();
  const count = item.images.length;
  const titleId = `${lookAnchorId(item.slug)}-title`;

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

  return (
    // An <article> (not a region landmark) labelled by the look's name.
    <article
      id={lookAnchorId(item.slug)}
      aria-labelledby={titleId}
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
        {item.images.map((image, i) => (
          <Link
            key={`${image.src}-${i}`}
            href={item.href}
            onClick={leave}
            tabIndex={-1}
            aria-label={image.alt.trim() ? undefined : `${item.name}, photo ${i + 1} of ${count}`}
            className="relative block h-full w-full flex-none snap-start"
          >
            <ImageFallback />
            <StorefrontImg
              image={{ src: image.src, srcSet: image.srcSet || undefined, alt: image.alt }}
              eager={priority !== "lazy" && i === 0}
              highPriority={priority === "high"}
              sizes={SLIDE_SIZES}
              className="object-[50%_20%]"
            />
          </Link>
        ))}
      </div>

      {/* Scrims: at least 65% ink behind every line of text, so cream text is >= 4.5:1 on any photo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[200px] bg-[linear-gradient(rgba(20,20,18,0.72)_0%,rgba(20,20,18,0.66)_55%,rgba(20,20,18,0)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[440px] max-h-[75%] bg-[linear-gradient(rgba(20,20,18,0)_0%,rgba(20,20,18,0.68)_24%,rgba(20,20,18,0.86)_100%)]"
      />

      {count > 1 ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[112px] flex justify-center gap-[5px]">
            {item.images.map((image, i) => (
              <span
                key={`${image.src}-bar-${i}`}
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

      <div className="absolute bottom-11 left-5 right-[92px] flex flex-col gap-2 text-brand-cream-50 [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]">
        {item.category ? (
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand-cream">{item.category}</span>
        ) : null}
        <h2 id={titleId} className="m-0 font-serif text-[32px] font-semibold leading-[1.02] text-balance">
          {item.name}
        </h2>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-lg font-medium">{item.price}</span>
          {item.badge ? (
            <span
              className={cn(
                "rounded-[2px] px-2 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.16em] [text-shadow:none]",
                badgeTone[item.badge.kind],
              )}
            >
              {item.badge.label}
            </span>
          ) : null}
        </div>
        <Link
          href={item.href}
          onClick={leave}
          className="sf-focus mt-1 inline-flex min-h-11 items-center gap-2 self-start rounded-[2px] border border-brand-cream-50/75 bg-[rgba(20,20,18,0.3)] px-4 text-xs font-medium uppercase tracking-[0.16em] text-brand-cream-50"
        >
          View details
          <span className="sr-only"> of the {item.name}</span>
          <ArrowIcon className="h-4 w-4" />
        </Link>
      </div>

      <div className="absolute bottom-[52px] right-3 flex flex-col items-center gap-[18px]">
        {item.enquireHref ? (
          <a
            href={item.enquireHref}
            className={railItem}
            aria-label={item.soldOut ? `Ask about a restock of the ${item.name} on WhatsApp` : `Enquire about the ${item.name} on WhatsApp`}
          >
            <span className={cn(railRing, "border border-brand-olive bg-brand-olive")}>
              <EnquireIcon className="h-6 w-6" />
            </span>
            <span className={railLabel}>{item.soldOut ? "Restock" : "Enquire"}</span>
          </a>
        ) : (
          <Link href={visitHref} className={railItem}>
            <span className={cn(railRing, "border border-brand-olive bg-brand-olive")}>
              <PinIcon className="h-6 w-6" />
            </span>
            <span className={railLabel}>Visit us</span>
          </Link>
        )}
        {item.shareUrl ? (
          <button
            type="button"
            onClick={() => share(item.shareUrl as string, `${item.name} – VYRA`)}
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
