"use client";

// ZP-490 share logic, shared by the product page ShareButton and the landing
// feed (ZP-500): the system share sheet (navigator.share) where there is one,
// otherwise copy the link. `status` says what happened, for a live region,
// and resets after 4 seconds.
import { useCallback, useEffect, useRef, useState } from "react";

export type ShareStatus = "idle" | "copied" | "failed";

/** What a share did (ZP-493 `share` event: "native" / "copy"; nothing is tracked for the others). */
export type ShareOutcome = "native" | "copy" | "cancelled" | "failed";

export function useShare(): { status: ShareStatus; share: (url: string, title: string) => Promise<ShareOutcome> } {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const announce = useCallback((next: ShareStatus) => {
    setStatus(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 4000);
  }, []);

  const share = useCallback(
    async (url: string, title: string): Promise<ShareOutcome> => {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title, url });
          return "native";
        } catch (error) {
          // The visitor closed the sheet: nothing to say. Anything else: fall back to copying.
          if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        announce("copied");
        return "copy";
      } catch {
        announce("failed");
        return "failed";
      }
    },
    [announce],
  );

  return { status, share };
}
