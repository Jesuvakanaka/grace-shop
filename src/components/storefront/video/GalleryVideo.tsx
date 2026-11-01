"use client";

import { videoLabel, type MediaVideo } from "@/lib/storefront/feed-media";
import { StorefrontImg } from "../StorefrontImage";
import { useAutoplayAllowed, useVideoPlayback } from "./useVideoPlayback";

type GalleryVideoProps = {
  video: MediaVideo;
  /** Product name: "<name> – video". */
  name: string;
  /** First item above the fold on the product page: poster eager. */
  eager: boolean;
};

/**
 * ZP-502: the product page gallery's first item when the piece has a video.
 * Muted, looping, inline, with the browser's own controls (keyboard play /
 * pause, unmute is the visitor's choice). Plays on its own only while at
 * least 60% on screen, and never with reduced motion or Save-Data. The
 * poster is a real <img> underneath, so a failed video still shows a picture.
 */
export function GalleryVideo({ video, name, eager }: GalleryVideoProps) {
  const autoplay = useAutoplayAllowed();
  const { ref, failed, events } = useVideoPlayback(autoplay);

  return (
    <>
      <StorefrontImg image={{ src: video.poster, alt: "" }} decorative eager={eager} sizes="(min-width: 1024px) 560px, 100vw" />
      {!failed ? (
        <video
          ref={ref}
          src={video.src}
          poster={video.poster}
          width={video.width}
          height={video.height}
          muted
          loop
          playsInline
          controls
          disablePictureInPicture
          preload="metadata"
          aria-label={videoLabel(name)}
          {...events}
          className="sf-focus absolute inset-0 h-full w-full bg-transparent object-cover"
        />
      ) : null}
    </>
  );
}
