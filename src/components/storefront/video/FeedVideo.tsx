"use client";

import Link from "next/link";
import { videoLabel, videoPreload, type MediaVideo } from "@/lib/storefront/feed-media";
import { cn } from "../cn";
import { ImageFallback, StorefrontImg } from "../StorefrontImage";
import { useAutoplayAllowed, useVideoPlayback } from "./useVideoPlayback";
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
  /** This slide's index minus the current slide's (preload: next slide only). */
  slideOffset: number;
  sizes: string;
};

/**
 * ZP-502: the first item of a feed slide's sideways strip when the piece
 * has a video. The poster is a real <img> underneath (eager and high priority
 * on the first slide, so it is the LCP element and shows without JavaScript
 * or when the video fails); the muted, looping, inline <video> fades in over
 * it once it actually plays. Only a video at least 60% on screen plays.
 * Tapping it opens the piece (a real link, like the photos); the round
 * button plays / pauses (with reduced motion or Save-Data: a large play
 * button on the poster, nothing starts on its own).
 */
export function FeedVideo({ video, name, href, onLeave, linkTabIndex, linkLabel, priority, slideOffset, sizes }: FeedVideoProps) {
  const autoplay = useAutoplayAllowed();
  const { ref, playing, failed, intent, toggle, events } = useVideoPlayback(autoplay);
  const preload = intent === "play" ? "auto" : videoPreload({ slideOffset, autoplay });
  // Waiting for the visitor: no autoplay here (or it was blocked), not playing.
  const invite = !playing && (!autoplay || intent === "pause");

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
        src={video.src}
        poster={video.poster}
        width={video.width}
        height={video.height}
        muted
        loop
        playsInline
        disablePictureInPicture
        preload={preload}
        aria-label={videoLabel(name)}
        {...events}
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
      {!failed ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? `Pause the ${name} video` : `Play the ${name} video`}
          className={cn(
            "sf-focus absolute flex items-center justify-center rounded-full text-brand-cream-50",
            invite
              ? "left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 border border-brand-cream-50/60 bg-[rgba(20,20,18,0.6)]"
              : "left-3 top-[84px] h-11 w-11 bg-[rgba(20,20,18,0.5)]",
          )}
        >
          {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className={invite ? "ml-1 h-7 w-7" : "h-5 w-5"} />}
        </button>
      ) : null}
    </div>
  );
}
