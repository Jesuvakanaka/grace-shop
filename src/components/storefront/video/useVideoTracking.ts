"use client";

import { useEffect, useRef, type SyntheticEvent } from "react";
import { track } from "@/lib/analytics/client";
import { documentVisibility } from "@/lib/analytics/dwell";
import { createVideoWatch, type VideoWatch } from "@/lib/storefront/tracking";

/**
 * ZP-493: analytics for one product video (feed strip or product gallery):
 * video_start, video_progress 25/50/75/100, video_replay (each loop) and
 * video_seconds (watched in this viewing). A viewing ends when the video
 * leaves the view (`visible`, the playback hook's own 60% observer) or
 * unmounts; the page hiding sends the seconds so far. Everything lives in a
 * ref: media events never re-render. `slug` null: nothing is tracked.
 * Returns media event handlers to add to the <video>.
 */
export function useVideoTracking(slug: string | null | undefined, visible: boolean, collection?: string) {
  const watch = useRef<VideoWatch | null>(null);
  const context = useRef({ slug, collection });
  useEffect(() => {
    context.current = { slug, collection };
  }, [slug, collection]);

  useEffect(() => {
    if (!slug) return;
    const w = createVideoWatch((e) => {
      const { slug: s, collection: c } = context.current;
      if (s) track(e.type, { slug: s, ...(c ? { collection: c } : {}), ...(e.props ?? {}) });
    });
    watch.current = w;
    const unsubscribe = documentVisibility.subscribe((v) => {
      if (!v) w.flush();
    });
    return () => {
      unsubscribe();
      w.end();
      watch.current = null;
    };
  }, [slug]);

  useEffect(() => {
    if (!visible) watch.current?.end();
  }, [visible]);

  return {
    onPlaying: () => watch.current?.playing(),
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => {
      const el = event.currentTarget;
      watch.current?.time(el.currentTime, el.duration);
    },
    onEnded: () => watch.current?.ended(),
  };
}
