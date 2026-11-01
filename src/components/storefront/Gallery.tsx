"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DWELL_VISIBLE_RATIO, track as trackEvent, useActiveDwell } from "@/lib/analytics/client";
import type { PublicVideo } from "@/lib/storefront/dto";
import { mediaItems } from "@/lib/storefront/feed-media";
import { photoProps } from "@/lib/storefront/tracking";
import { cn } from "./cn";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExpandIcon } from "./icons";
import { ImageFallback, ImageFrame, StorefrontImg } from "./StorefrontImage";
import type { StorefrontImageData } from "./types";
import { GalleryVideo } from "./video/GalleryVideo";
import { PlayIcon } from "./video/video-icons";

type GalleryProps = {
  images: StorefrontImageData[];
  /** ZP-502: the product video, shown first (before the photos); not in the full-screen view. */
  video?: PublicVideo | null;
  /** Product name, used in control labels ("Show photo 2 of 4 of Lime wrap dress"). */
  label: string;
  /** First photo is above the fold on a product page: load it eagerly. */
  eager?: boolean;
  /**
   * ZP-503: a "1 / N" counter on the photo instead of the phone dots (below
   * lg; desktop has the thumbnail rail). The video counts as item 1; the
   * counter hides while it shows (it would sit over the native controls).
   * The previous / next arrows then show from md, so 640–1023px mouse users
   * can still change photo.
   */
  counter?: boolean;
  className?: string;
  /**
   * ZP-493: the piece, for analytics (photo_view / photo_dwell of the photo
   * on screen while the gallery is at least 60% visible, gallery_zoom, the
   * video events). Without it nothing is tracked.
   */
  slug?: string;
};

/**
 * Product gallery without dependencies: a CSS scroll-snap track (swipe on
 * phones, with dots), a thumbnail rail on desktop, and a full-screen zoom in
 * a native <dialog>. The track is the source of truth; thumbnails and dots
 * scroll it, and an IntersectionObserver reports which item is showing.
 *
 * ZP-502: with a video, the track's first item is the video (inline, muted,
 * native controls; GalleryVideo), then the photos; dots and thumbnails count
 * it. The full-screen view shows the photos only.
 */
export function Gallery({ images, video, label, eager = true, counter = false, className, slug }: GalleryProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDialogElement>(null);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(0);
  /** The photo shown full screen (an index into `images`). */
  const [zoomed, setZoomed] = useState(0);
  const items = mediaItems(images, video);
  const count = items.length;
  const photoCount = images.length;
  /** Track index of the first photo (1 when the video comes first). */
  const offset = items[0]?.kind === "video" ? 1 : 0;
  const onVideo = offset === 1 && active === 0;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const slides = Array.from(track.children) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root: track, threshold: 0.6 },
    );
    slides.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [count]);

  // ZP-493: the gallery itself on screen (>= 60%; an observer, no scroll
  // handler), and the photo it shows: photo_view once per photo shown,
  // photo_dwell while it stays (useActiveDwell: page visible, 0.5 s floor, 60 s cap).
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = trackRef.current;
    if (!slug || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(entry.isIntersecting && entry.intersectionRatio >= DWELL_VISIBLE_RATIO - 0.001);
      },
      { threshold: [0, DWELL_VISIBLE_RATIO, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [slug, count]);
  const shownPhoto = slug && inView && items[active]?.kind === "image" ? photoProps(images, active - offset) : null;
  const shownKey = shownPhoto ? `${slug}-${shownPhoto.index}` : null;
  useEffect(() => {
    if (slug && shownPhoto) trackEvent("photo_view", { slug, ...shownPhoto });
    // Once per photo shown (shownKey), not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);
  useActiveDwell(
    shownPhoto !== null,
    (seconds, page) => {
      if (slug && shownPhoto) trackEvent("photo_dwell", { slug, ...shownPhoto, seconds, page });
    },
    shownKey,
  );

  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const i = (index + count) % count;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: i * track.clientWidth, behavior: reduce ? "auto" : "smooth" });
    setActive(i);
  };

  /** Full screen: photos only (from the video, the first photo). */
  const openZoom = () => {
    if (photoCount === 0) return;
    const photo = Math.max(0, active - offset);
    setZoomed(photo);
    zoomRef.current?.showModal();
    if (slug) trackEvent("gallery_zoom", { slug, ...(photo < 50 ? { index: photo + 1 } : {}) });
  };
  const closeZoom = () => zoomRef.current?.close();
  const zoomStep = (dir: 1 | -1) => {
    const i = (zoomed + dir + photoCount) % photoCount;
    setZoomed(i);
    goTo(i + offset);
  };

  // ZP-490: in the full-screen view, arrows change photo (Esc closes natively)
  // and Tab cycles through the dialog's own buttons only.
  const onZoomKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (photoCount < 2) return;
      e.preventDefault();
      zoomStep(e.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (count === 0) {
    return (
      <ImageFrame ratio="4 / 5" className={className}>
        <span className="sr-only">No photos yet</span>
      </ImageFrame>
    );
  }

  const itemLabel = (i: number) => (offset === 1 && i === 0 ? "Show the video" : `Show photo ${i - offset + 1} of ${photoCount}`);

  return (
    <div className={cn("flex flex-col gap-4 lg:flex-row-reverse lg:gap-5", className)}>
      <div className="relative min-w-0 flex-1">
        <div
          ref={trackRef}
          role="region"
          aria-roledescription="carousel"
          aria-label={`${label} photos`}
          tabIndex={0}
          className="sf-focus sf-scroll-x sf-snap-x sf-smooth flex rounded-[2px] scroll-smooth"
          onKeyDown={(e) => {
            // Arrow keys on the video's own controls seek the video.
            if (e.target !== e.currentTarget) return;
            if (e.key === "ArrowRight") {
              e.preventDefault();
              goTo(active + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              goTo(active - 1);
            }
          }}
        >
          {items.map((item, i) =>
            item.kind === "video" ? (
              <div
                key={`video-${item.video.src}`}
                data-index={i}
                className="w-full shrink-0"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}, video`}
              >
                <ImageFrame ratio="4 / 5">
                  <GalleryVideo video={item.video} name={label} eager={eager} slug={slug} />
                </ImageFrame>
              </div>
            ) : (
              <div
                key={item.image.src + i}
                data-index={i}
                // ZP-490: click/tap the photo to zoom (the expand button is the keyboard route).
                onClick={openZoom}
                className="w-full shrink-0 cursor-zoom-in"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
              >
                <ImageFrame ratio="4 / 5">
                  <StorefrontImg image={item.image} eager={eager && i === 0} sizes="(min-width: 1024px) 560px, 100vw" />
                </ImageFrame>
              </div>
            ),
          )}
        </div>

        {photoCount > 0 ? (
          <button
            ref={zoomButtonRef}
            type="button"
            onClick={openZoom}
            className="sf-focus absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-[2px] bg-white/90 text-brand-ink transition-colors duration-200 hover:bg-white"
            aria-label={onVideo ? "View the photos full screen" : `View photo ${active - offset + 1} of ${photoCount} full screen`}
          >
            <ExpandIcon />
          </button>
        ) : null}

        {count > 1 ? (
          <>
            <div className={counter ? "hidden md:block" : "hidden lg:block"}>
              <button
                type="button"
                onClick={() => goTo(active - 1)}
                className="sf-focus absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[2px] bg-white/90 text-brand-ink hover:bg-white"
                aria-label="Previous photo"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                onClick={() => goTo(active + 1)}
                className="sf-focus absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[2px] bg-white/90 text-brand-ink hover:bg-white"
                aria-label="Next photo"
              >
                <ChevronRightIcon />
              </button>
            </div>
            {counter && !onVideo ? (
              <p aria-hidden="true" className="pointer-events-none absolute bottom-3 right-3 rounded-[2px] bg-brand-ink/70 px-2.5 py-1 text-xs tracking-[0.08em] text-brand-cream-50 lg:hidden">
                {active + 1} / {count}
              </p>
            ) : null}
            {/* Dots (phones). Each dot is a 44px tap target around a small mark. */}
            <div className={counter ? "hidden" : "mt-1 flex justify-center lg:hidden"}>
              {items.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={itemLabel(i)}
                  aria-current={i === active ? "true" : undefined}
                  className="sf-focus group inline-flex h-11 w-11 items-center justify-center rounded-[2px]"
                >
                  <span
                    className={cn(
                      "block h-1.5 rounded-full transition-all duration-200",
                      i === active ? "w-5 bg-brand-ink" : "w-1.5 bg-brand-ink/50 group-hover:bg-brand-ink/80",
                    )}
                  />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <ul className="hidden w-20 shrink-0 flex-col gap-3 lg:flex" aria-label="Photos">
          {items.map((item, i) => (
            <li key={item.kind === "video" ? `video-${item.video.src}` : item.image.src + i}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-label={itemLabel(i)}
                aria-current={i === active ? "true" : undefined}
                className={cn(
                  "sf-focus block w-full rounded-[2px] ring-1 transition-shadow duration-200",
                  i === active ? "ring-2 ring-brand-ink" : "ring-brand-ink/10 hover:ring-brand-ink/40",
                )}
              >
                <ImageFrame ratio="4 / 5" className="rounded-[2px]">
                  {item.kind === "video" ? (
                    <>
                      <StorefrontImg image={{ src: item.video.poster, alt: "" }} decorative sizes="80px" />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(20,20,18,0.6)] text-brand-cream-50">
                          <PlayIcon className="ml-0.5 h-4 w-4" />
                        </span>
                      </span>
                    </>
                  ) : (
                    <StorefrontImg image={item.image} decorative sizes="80px" />
                  )}
                </ImageFrame>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {photoCount > 0 ? (
        <dialog
          ref={zoomRef}
          aria-label={`${label}, photo ${zoomed + 1} of ${photoCount}`}
          onClose={() => zoomButtonRef.current?.focus()}
          onKeyDown={onZoomKeyDown}
          className="sf-dialog bg-brand-cream-100 text-brand-ink"
        >
          <div className="relative flex h-full w-full items-center justify-center">
            <div className="relative h-full max-h-full w-auto" style={{ aspectRatio: "4 / 5" }}>
              <ImageFallback />
              {images[zoomed] ? (
                // key: a fresh <img> per photo, so a failed photo's state never carries over.
                <StorefrontImg key={`${zoomed}-${images[zoomed].src}`} image={images[zoomed]} fit="contain" eager sizes="100vw" />
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeZoom}
              className="sf-focus absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-[2px] bg-white text-brand-ink"
              aria-label="Close full screen"
            >
              <CloseIcon />
            </button>
            {photoCount > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => zoomStep(-1)}
                  className="sf-focus absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[2px] bg-white text-brand-ink"
                  aria-label="Previous photo"
                >
                  <ChevronLeftIcon />
                </button>
                <button
                  type="button"
                  onClick={() => zoomStep(1)}
                  className="sf-focus absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[2px] bg-white text-brand-ink"
                  aria-label="Next photo"
                >
                  <ChevronRightIcon />
                </button>
                <p className="sf-label absolute bottom-4 left-1/2 -translate-x-1/2 bg-white px-3 py-2 text-brand-ink" aria-live="polite">
                  {zoomed + 1} / {photoCount}
                </p>
              </>
            ) : null}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
