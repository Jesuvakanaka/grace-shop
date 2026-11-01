"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  autoplayAllowed,
  VIDEO_STALL_MS,
  VIDEO_VISIBLE_RATIO,
  videoShouldPlay,
  type PlayIntent,
} from "@/lib/storefront/feed-media";

// ZP-502: shared playback rules for product videos (feed strip and product
// gallery). See src/lib/storefront/feed-media.ts and docs/storefront/videos.md.

type NetworkInformation = {
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};
const connection = (): NetworkInformation | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: NetworkInformation }).connection;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  const conn = connection();
  conn?.addEventListener?.("change", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    conn?.removeEventListener?.("change", onChange);
  };
}

const clientAutoplay = () =>
  autoplayAllowed({ reducedMotion: window.matchMedia(REDUCED_MOTION).matches, saveData: connection()?.saveData === true });

/**
 * May videos start on their own here? False on the server and during
 * hydration (no autoplay, preload "none" in the HTML, so nothing competes
 * with the first photo / poster), then the browser's answer: not with
 * prefers-reduced-motion or Save-Data.
 */
export function useAutoplayAllowed(): boolean {
  return useSyncExternalStore(subscribe, clientAutoplay, () => false);
}

/**
 * Plays the video only while it is at least 60% on screen (an
 * IntersectionObserver on the <video> itself, so it covers both the
 * vertical feed and a sideways strip / gallery: clipped parts do not count),
 * pauses it otherwise. The visitor's own play / pause (button, or the native
 * controls) wins over autoplay. A load error, or no picture within
 * VIDEO_STALL_MS of asking to play, marks it failed: the poster stays.
 */
export function useVideoPlayback(autoplay: boolean) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [intent, setIntent] = useState<PlayIntent>("auto");
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  /**
   * What this hook last asked the element for. Play/pause events arrive
   * later; one that disagrees is the visitor's own (native controls).
   */
  const expected = useRef<"playing" | "paused">("paused");
  const stall = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const shouldPlay = videoShouldPlay({ visible, autoplay, intent, failed });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting && e.intersectionRatio >= VIDEO_VISIBLE_RATIO - 0.001);
      },
      { threshold: [0, VIDEO_VISIBLE_RATIO, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const clearStall = useCallback(() => {
    clearTimeout(stall.current);
    stall.current = undefined;
  }, []);

  const pauseSelf = useCallback((el: HTMLVideoElement) => {
    expected.current = "paused";
    if (!el.paused) el.pause();
  }, []);

  const armStall = useCallback(() => {
    clearTimeout(stall.current);
    stall.current = setTimeout(() => {
      const el = ref.current;
      // HAVE_FUTURE_DATA (3): enough to play on. Below that after the wait: give up.
      if (el && el.readyState < 3) {
        setFailed(true);
        pauseSelf(el);
      }
    }, VIDEO_STALL_MS);
  }, [pauseSelf]);

  const playSelf = useCallback(
    (el: HTMLVideoElement) => {
      el.muted = true; // the property: React does not always reflect the attribute
      expected.current = "playing";
      armStall();
      const attempt = el.play();
      attempt?.catch((error: unknown) => {
        // AbortError: paused again before it started (scrolled on): fine.
        // NotAllowedError (e.g. iOS Low Power Mode): poster and play button.
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          clearStall();
          expected.current = "paused";
          setIntent("pause");
        }
      });
    },
    [armStall, clearStall],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shouldPlay) {
      playSelf(el);
    } else {
      clearStall();
      pauseSelf(el);
    }
  }, [shouldPlay, playSelf, pauseSelf, clearStall]);

  useEffect(() => clearStall, [clearStall]);

  /** The play / pause button. Plays inside the click, so a blocked autoplay can start. */
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.paused) {
      setIntent("pause");
      pauseSelf(el);
      return;
    }
    setFailed(false);
    setIntent("play");
    playSelf(el);
  }, [pauseSelf, playSelf]);

  const events = {
    onPlaying: () => {
      clearStall();
      setPlaying(true);
    },
    onPause: () => {
      setPlaying(false);
      if (expected.current === "playing") {
        expected.current = "paused";
        setIntent("pause");
      }
    },
    onPlay: () => {
      if (expected.current === "paused") {
        expected.current = "playing";
        setIntent("play");
      }
    },
    onWaiting: () => {
      if (expected.current === "playing") armStall();
    },
    onError: () => {
      clearStall();
      setFailed(true);
      setPlaying(false);
    },
  };

  return { ref, visible, playing, failed, intent, toggle, events };
}
