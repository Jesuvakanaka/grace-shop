"use client";

// ZP-490: "Share" on the product page. Uses the system share sheet
// (navigator.share) where there is one, otherwise copies the link, and says
// what happened in a polite live region. The logic is in ./useShare (shared
// with the landing feed, ZP-500).
import { buttonClasses } from "../Button";
import { useShare } from "./useShare";

export function ShareButton({ url, title, className }: { url: string; title: string; className?: string }) {
  const { status, share } = useShare();

  return (
    <div className={className}>
      <button type="button" onClick={() => share(url, title)} className={buttonClasses("ghost", true)}>
        Share
      </button>
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-center text-sm text-brand-ink-soft">
        {status === "copied" ? "Link copied" : status === "failed" ? `Copy this link: ${url}` : ""}
      </p>
    </div>
  );
}
