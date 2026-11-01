"use client";

// ZP-490: "Share" on the product page. Uses the system share sheet
// (navigator.share) where there is one, otherwise copies the link, and says
// what happened in a polite live region.
import { useEffect, useRef, useState } from "react";
import { buttonClasses } from "../Button";

type Status = "idle" | "copied" | "failed";

export function ShareButton({ url, title, className }: { url: string; title: string; className?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const announce = (next: Status) => {
    setStatus(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 4000);
  };

  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // The visitor closed the sheet: nothing to say. Anything else: fall back to copying.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      announce("copied");
    } catch {
      announce("failed");
    }
  };

  return (
    <div className={className}>
      <button type="button" onClick={share} className={buttonClasses("ghost", true)}>
        Share
      </button>
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-center text-sm text-brand-ink-soft">
        {status === "copied" ? "Link copied" : status === "failed" ? `Copy this link: ${url}` : ""}
      </p>
    </div>
  );
}
