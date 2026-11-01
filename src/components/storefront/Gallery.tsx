"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "./cn";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ExpandIcon } from "./icons";
import { ImageFallback, ImageFrame, StorefrontImg } from "./StorefrontImage";
import type { StorefrontImageData } from "./types";

type GalleryProps = {
  images: StorefrontImageData[];
  /** Product name, used in control labels ("Show photo 2 of 4 of Lime wrap dress"). */
  label: string;
  /** First photo is above the fold on a product page: load it eagerly. */
  eager?: boolean;
  className?: string;
};

/**
 * Product gallery without dependencies: a CSS scroll-snap track (swipe on
 * phones, with dots), a thumbnail rail on desktop, and a full-screen zoom in
 * a native <dialog>. The track is the source of truth; thumbnails and dots
 * scroll it, and an IntersectionObserver reports which photo is showing.
 */
export function Gallery({ images, label, eager = true, className }: GalleryProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDialogElement>(null);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(0);
  const count = images.length;

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

  const goTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const i = (index + count) % count;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: i * track.clientWidth, behavior: reduce ? "auto" : "smooth" });
    setActive(i);
  };

  const openZoom = () => zoomRef.current?.showModal();
  const closeZoom = () => zoomRef.current?.close();

  // ZP-490: in the full-screen view, arrows change photo (Esc closes natively)
  // and Tab cycles through the dialog's own buttons only.
  const onZoomKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (count < 2) return;
      e.preventDefault();
      goTo(active + (e.key === "ArrowRight" ? 1 : -1));
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
            if (e.key === "ArrowRight") {
              e.preventDefault();
              goTo(active + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              goTo(active - 1);
            }
          }}
        >
          {images.map((img, i) => (
            <div
              key={img.src + i}
              data-index={i}
              // ZP-490: click/tap the photo to zoom (the expand button is the keyboard route).
              onClick={openZoom}
              className="w-full shrink-0 cursor-zoom-in"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
            >
              <ImageFrame ratio="4 / 5">
                <StorefrontImg image={img} eager={eager && i === 0} sizes="(min-width: 1024px) 560px, 100vw" />
              </ImageFrame>
            </div>
          ))}
        </div>

        <button
          ref={zoomButtonRef}
          type="button"
          onClick={openZoom}
          className="sf-focus absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-[2px] bg-white/90 text-brand-ink transition-colors duration-200 hover:bg-white"
          aria-label={`View photo ${active + 1} of ${count} full screen`}
        >
          <ExpandIcon />
        </button>

        {count > 1 ? (
          <>
            <div className="hidden lg:block">
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
            {/* Dots (phones). Each dot is a 44px tap target around a small mark. */}
            <div className="mt-1 flex justify-center lg:hidden">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Show photo ${i + 1} of ${count}`}
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
          {images.map((img, i) => (
            <li key={img.src + i}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show photo ${i + 1} of ${count}`}
                aria-current={i === active ? "true" : undefined}
                className={cn(
                  "sf-focus block w-full rounded-[2px] ring-1 transition-shadow duration-200",
                  i === active ? "ring-2 ring-brand-ink" : "ring-brand-ink/10 hover:ring-brand-ink/40",
                )}
              >
                <ImageFrame ratio="4 / 5" className="rounded-[2px]">
                  <StorefrontImg image={img} decorative sizes="80px" />
                </ImageFrame>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <dialog
        ref={zoomRef}
        aria-label={`${label}, photo ${active + 1} of ${count}`}
        onClose={() => zoomButtonRef.current?.focus()}
        onKeyDown={onZoomKeyDown}
        className="sf-dialog bg-brand-cream-100 text-brand-ink"
      >
        <div className="relative flex h-full w-full items-center justify-center">
          <div className="relative h-full max-h-full w-auto" style={{ aspectRatio: "4 / 5" }}>
            <ImageFallback />
            {images[active] ? (
              // key: a fresh <img> per photo, so a failed photo's state never carries over.
              <StorefrontImg key={`${active}-${images[active].src}`} image={images[active]} fit="contain" eager sizes="100vw" />
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
          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={() => goTo(active - 1)}
                className="sf-focus absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[2px] bg-white text-brand-ink"
                aria-label="Previous photo"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                onClick={() => goTo(active + 1)}
                className="sf-focus absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[2px] bg-white text-brand-ink"
                aria-label="Next photo"
              >
                <ChevronRightIcon />
              </button>
              <p className="sf-label absolute bottom-4 left-1/2 -translate-x-1/2 bg-white px-3 py-2 text-brand-ink" aria-live="polite">
                {active + 1} / {count}
              </p>
            </>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
