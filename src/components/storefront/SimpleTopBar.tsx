// ZP-514: the top bar of the few storefront pages that are not the feed
// (privacy, the review form, the 404): the wordmark and "Back to the looks",
// both to the landing feed. Everything else is the feed itself, so there is
// no header navigation and no footer any more.
import Link from "next/link";
import { Wordmark } from "./Brand";

export function SimpleTopBar({ homeHref }: { homeHref: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-ink/10! bg-brand-cream/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={homeHref} className="sf-focus inline-flex min-h-11 items-center rounded-[2px]" aria-label="VYRA, back to the looks">
          <Wordmark className="h-[18px] w-auto" title="" />
        </Link>
        <Link
          href={homeHref}
          className="sf-focus inline-flex min-h-11 items-center gap-1.5 rounded-[2px] text-xs font-medium uppercase tracking-[0.16em] text-brand-ink hover:text-brand-olive-700"
        >
          <span aria-hidden="true">←</span> Back to the looks
        </Link>
      </div>
    </header>
  );
}
