"use client";

// ZP-503: the product page's slim sticky top bar on phones: back to the
// feed, the wordmark (home), Share. Back is a real link to the feed at this
// look; when the visitor came from the feed it uses history.back() instead,
// so the feed returns as they left it (src/lib/storefront/back-target.ts).
import Link from "next/link";
import type { MouseEvent } from "react";
import { feedLookHref, shouldGoBack } from "@/lib/storefront/back-target";
import { Wordmark } from "../Brand";
import { ChevronLeftIcon } from "../icons";
import { previousPathname } from "./NavMemory";
import { useShare } from "./useShare";

const iconButton =
  "sf-focus inline-flex h-11 w-11 items-center justify-center rounded-[2px] text-brand-ink transition-colors duration-200 hover:bg-brand-ink/5";

function ShareIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

export function ProductTopBar({
  homeHref,
  slug,
  shareUrl,
  shareTitle,
}: {
  homeHref: string;
  slug: string;
  /** Absolute public URL; null hides Share (no URL, or an owner preview). */
  shareUrl: string | null;
  shareTitle: string;
}) {
  const { status, share } = useShare();

  const onBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const back = shouldGoBack({
      previousPath: previousPathname(),
      referrer: document.referrer,
      origin: window.location.origin,
      homeHref,
      historyLength: window.history.length,
    });
    if (!back) return;
    event.preventDefault();
    window.history.back();
  };

  return (
    <div data-product-topbar className="sticky top-0 z-40 grid h-[58px] grid-cols-[44px_1fr_44px] items-center gap-2 border-b border-brand-ink/10! bg-brand-cream-50/95 px-2 backdrop-blur-sm lg:hidden">
      <Link href={feedLookHref(homeHref, slug)} onClick={onBack} className={iconButton} aria-label="Back to the looks">
        <ChevronLeftIcon className="h-6 w-6" />
      </Link>
      <Link
        href={homeHref}
        aria-label="VYRA – Wear Different, home"
        className="sf-focus inline-flex min-h-11 items-center justify-self-center rounded-[2px] px-2"
      >
        <Wordmark className="h-[18px] w-auto text-brand-ink" title="" />
      </Link>
      {shareUrl ? (
        <button type="button" onClick={() => share(shareUrl, shareTitle)} className={iconButton} aria-label="Share this piece">
          <ShareIcon />
        </button>
      ) : (
        <span aria-hidden="true" className="h-11 w-11" />
      )}
      <p
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-4 top-full mt-2 text-center text-sm"
      >
        {status === "copied" ? (
          <span className="inline-block rounded-[2px] bg-brand-ink px-4 py-2 text-brand-cream-50">Link copied</span>
        ) : status === "failed" ? (
          <span className="inline-block break-all rounded-[2px] bg-brand-ink px-4 py-2 text-brand-cream-50">Copy this link: {shareUrl}</span>
        ) : null}
      </p>
    </div>
  );
}
