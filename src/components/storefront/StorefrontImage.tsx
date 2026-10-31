"use client";

import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import { Mark } from "./Brand";
import { cn } from "./cn";
import type { StorefrontImageData } from "./types";

// Images never show a broken icon: every frame paints a cream tile with the
// VYRA mark first, and the photo sits on top of it.
//
// Photos are visible by default, so they show without JavaScript and before
// hydration. Once hydrated, a photo that has not finished loading is marked
// data-pending (hidden) and fades in when it loads; a photo that failed is
// marked data-failed (hidden, so the tile shows). A photo that loaded before
// hydration is left alone, so nothing flashes. State lives in data-*
// attributes, not React state. Without JavaScript, a CSS ::before layer
// covers the browser's broken-image icon (globals.css, `.sf-img::before`).

function settle(img: HTMLImageElement) {
  delete img.dataset.pending;
  if (img.naturalWidth > 0) img.dataset.loaded = "";
  else img.dataset.failed = "";
}

function onLoad(event: SyntheticEvent<HTMLImageElement>) {
  settle(event.currentTarget);
}

function onError(event: SyntheticEvent<HTMLImageElement>) {
  delete event.currentTarget.dataset.pending;
  event.currentTarget.dataset.failed = "";
}

function lazyRef(img: HTMLImageElement | null) {
  if (!img) return;
  if (img.complete) settle(img);
  else img.dataset.pending = "";
}

function eagerRef(img: HTMLImageElement | null) {
  // Eager (LCP) photos never hide; only catch a failure that happened before hydration.
  if (img && img.complete) settle(img);
}

export type ImageSource = { media: string; image: StorefrontImageData };

type StorefrontImgProps = {
  image: StorefrontImageData;
  /** Art direction: the first matching source wins, `image` is the fallback (renders a <picture>). */
  sources?: ImageSource[];
  /** Above the fold (hero, first gallery photo): load eagerly, high priority, no fade. */
  eager?: boolean;
  sizes?: string;
  /** "cover" fills a fixed-ratio frame; "contain" shows the whole photo (zoom view). */
  fit?: "cover" | "contain";
  className?: string;
  /** Render with empty alt (decorative duplicate, e.g. the hover photo). */
  decorative?: boolean;
};

/** A photo that fills its ImageFrame, with the no-broken-image behaviour above. */
export function StorefrontImg({
  image,
  sources,
  eager = false,
  sizes,
  fit = "cover",
  className,
  decorative = false,
}: StorefrontImgProps) {
  const img = (
    // Plain <img> with srcset: storefront photos come from
    // /api/images/public?w= (ZP-484), not the Next image optimiser.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={eager ? eagerRef : lazyRef}
      src={image.src}
      srcSet={image.srcSet}
      alt={decorative ? "" : image.alt}
      width={image.width}
      height={image.height}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      onLoad={onLoad}
      onError={onError}
      className={cn(
        "sf-img absolute inset-0 h-full w-full",
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
    />
  );
  if (!sources?.length) return img;
  return (
    <picture>
      {sources.map((s) => (
        <source key={s.media} media={s.media} srcSet={s.image.src} width={s.image.width} height={s.image.height} />
      ))}
      {img}
    </picture>
  );
}

/** The cream tile with the VYRA mark, shown while loading and if a photo fails. */
export function ImageFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("absolute inset-0 flex items-center justify-center bg-brand-cream-100", className)}
    >
      <Mark tone="mono" className="h-1/5 w-1/5 max-h-20 max-w-20 text-brand-cream-300" />
    </div>
  );
}

type ImageFrameProps = {
  /** CSS aspect ratio, e.g. "4 / 5". */
  ratio?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

/** Fixed-ratio box with the fallback tile underneath its photos. */
export function ImageFrame({ ratio = "4 / 5", className, style, children }: ImageFrameProps) {
  return (
    <div className={cn("relative overflow-hidden bg-brand-cream-100", className)} style={{ aspectRatio: ratio, ...style }}>
      <ImageFallback />
      {children}
    </div>
  );
}
