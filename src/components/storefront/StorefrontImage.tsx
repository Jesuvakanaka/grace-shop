"use client";

import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import { Mark } from "./Brand";
import { cn } from "./cn";
import type { StorefrontImageData } from "./types";

// Images never show a broken icon: every frame paints a cream tile with the
// VYRA mark first, and the photo fades in on top once it has loaded. If it
// fails, the photo is hidden and the tile stays. State lives in data-*
// attributes (no React state), so a photo that finished loading before
// hydration is picked up by the ref callback.

function markLoaded(img: HTMLImageElement) {
  if (img.naturalWidth > 0) img.dataset.loaded = "";
  else img.dataset.failed = "";
}

function onLoad(event: SyntheticEvent<HTMLImageElement>) {
  markLoaded(event.currentTarget);
}

function onError(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.dataset.failed = "";
}

function checkComplete(img: HTMLImageElement | null) {
  if (img && img.complete) markLoaded(img);
}

type StorefrontImgProps = {
  image: StorefrontImageData;
  /** Above the fold (hero, first gallery photo): load eagerly, no fade. */
  eager?: boolean;
  sizes?: string;
  className?: string;
  /** Render with empty alt (decorative duplicate, e.g. the hover photo). */
  decorative?: boolean;
};

/** A photo that fills its ImageFrame (object-fit cover). */
export function StorefrontImg({ image, eager = false, sizes, className, decorative = false }: StorefrontImgProps) {
  return (
    // Plain <img>: sources are local files or inline SVG placeholders with
    // explicit sizes; next/image can replace this once ZP-484 serves photos.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={checkComplete}
      src={image.src}
      alt={decorative ? "" : image.alt}
      width={image.width}
      height={image.height}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding={eager ? "sync" : "async"}
      data-eager={eager ? "" : undefined}
      onLoad={onLoad}
      onError={onError}
      className={cn("sf-img absolute inset-0 h-full w-full object-cover", className)}
    />
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
