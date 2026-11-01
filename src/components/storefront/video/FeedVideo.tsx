"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { videoLabel, videoPreload, videoSourceAttached, type MediaVideo } from "@/lib/storefront/feed-media";
import { cn } from "../cn";
import { ImageFallback, StorefrontImg } from "../StorefrontImage";
import { useAutoplayAllowed, useMounted, useVideoPlayback } from "./useVideoPlayback";
import { useVideoTracking } from "./useVideoTracking";
import { PauseIcon, PlayIcon } from "./video-icons";

type FeedVideoProps = {
  video: MediaVideo;
  /** Product name: "<name> – video", button names. */
  name: string;
  href: string;
  onLeave: () => void;
  /** The link's tab stop and name (clean view: the slide's way in). */
  linkTabIndex: 0 | -1;
  linkLabel: string;
  /** Poster loading, as for a first photo: "high" on slide 1 (the LCP). */
  priority: "high" | "eager" | "lazy";
  /**
   * This slide's index minus the current slide's (preload: next slide only;
   * src: within one slide). Null until the current slide is known.
   */
  slideOffset: number | null;
  sizes: string;
  /** ZP-493: the piece and feed tab for the video analytics events. */
  slug?: string;
  collection?: string;
};

/**
 * ZP-502: the first item of a feed slide's sideways strip when the piece
 * has a video. The poster is a real <img> underneath (eager and high priority
 * on the first slide, so it is the LCP element and shows without JavaScript
 * or when the video fails); the muted, looping, inline <video> fades in over
 * it once it actually plays (so the <video> has no poster attribute). Only
 * a video at least 60% on screen plays; only the current slide and its
 * neighbours hold a `src` (further away it is removed and the element reset).
 * Tapping it opens the piece (a real link, like the photos); the round
 * button plays / pauses (with reduced motion or Save-Data: a large play
 * button on the poster, nothing starts on its own).
 */
export function FeedVideo({
  video,
  name,
  href,
  onLeave,
  linkTabIndex,
  linkLabel,
  priority,
  slideOffset,
  sizes,
  slug,
  collection,
}: FeedVideoProps) {
  const autoplay = useAutoplayAllowed();
  const mounted = useMounted();
  const { ref, visible, playing, requested, failed, intent, toggle, events } = useVideoPlayback(autoplay, { nativeControls: false });
  const tracking = useVideoTracking(slug, visible, collection);
  // Only near the current slide does the element hold a source (frees decoders far away).
  const attached = videoSourceAttached(slideOffset);
  const preload = !attached ? "none" : intent === "play" ? "auto" : videoPreload({ slideOffset, autoplay });
  // Waiting for the visitor: no autoplay here (or it was blocked), nothing requested.
  const invite = !requested && (!autoplay || intent === "pause");

  // Source removed (far away again): reset the element so the browser drops its buffers.
  const wasAttached = useRef(attached);
  useEffect(() => {
    if (wasAttached.current && !attached) ref.current?.load();
    wasAttached.current = attached;
  }, [attached, ref]);

  return (
    <div className="relative h-full w-full flex-none snap-start">
      <ImageFallback />
      <StorefrontImg
        image={{ src: video.poster, alt: "" }}
        decorative
        eager={priority !== "lazy"}
        highPriority={priority === "high"}
        sizes={sizes}
        className="object-[50%_20%]"
      />
      <video
        ref={ref}
        // No `poster` attribute: it is never lazy, so every video slide would fetch it at load and
        // compete with the LCP image. The <img> above is the visible poster (the video is hidden until it plays).
        src={attached ? video.src : undefined}
        width={video.width}
        height={video.height}
        muted
        loop
        playsInline
        disablePictureInPicture
        preload={preload}
        aria-label={videoLabel(name)}
        {...events}
        onPlaying={() => {
          events.onPlaying();
          tracking.onPlaying();
        }}
        onTimeUpdate={tracking.onTimeUpdate}
        onEnded={tracking.onEnded}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_20%] transition-opacity duration-200 motion-reduce:transition-none",
          playing && !failed ? "opacity-100" : "opacity-0",
        )}
      />
      <Link
        href={href}
        onClick={onLeave}
        tabIndex={linkTabIndex}
        aria-label={linkLabel}
        className="sf-focus absolute inset-0 focus-visible:outline-offset-[-4px]"
      />
      {/* After mount only: whether to invite a tap is a browser question (no flash over the LCP poster). */}
      {mounted && !failed ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={requested ? `Pause the ${name} video` : `Play the ${name} video`}
          className={cn(
            "sf-focus absolute flex items-center justify-center rounded-full text-brand-cream-50",
            invite
              ? "left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 border border-brand-cream-50/60 bg-[rgba(20,20,18,0.6)]"
              : "left-3 top-[84px] h-11 w-11 bg-[rgba(20,20,18,0.5)]",
          )}
        >
          {requested ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className={invite ? "ml-1 h-7 w-7" : "h-5 w-5"} />}
        </button>
      ) : null}
    </div>
  );
}
