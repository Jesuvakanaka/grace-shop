"use client";

// ZP-490: "Share" on the product page. Uses the system share sheet
// (navigator.share) where there is one, otherwise copies the link, and says
// what happened in a polite live region. The logic is in ./useShare (shared
// with the landing feed, ZP-500). ZP-493: a completed share is tracked
// (`share`, method native / copy) when `slug` is given.
import { track } from "@/lib/analytics/client";
import { buttonClasses } from "../Button";
import { useShare } from "./useShare";

export function ShareButton({ url, title, slug, className }: { url: string; title: string; slug?: string; className?: string }) {
  const { status, share } = useShare();

  const onClick = async () => {
    const outcome = await share(url, title);
    if (slug && (outcome === "native" || outcome === "copy")) track("share", { slug, method: outcome, screen: "product" });
  };

  return (
    <div className={className}>
      <button type="button" onClick={() => void onClick()} className={buttonClasses("ghost", true)}>
        Share
      </button>
      <p aria-live="polite" role="status" className="mt-2 min-h-5 text-center text-sm text-brand-ink-soft">
        {status === "copied" ? "Link copied" : status === "failed" ? `Copy this link: ${url}` : ""}
      </p>
    </div>
  );
}
