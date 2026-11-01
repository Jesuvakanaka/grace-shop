import Link from "next/link";
import { pageWindow } from "@/lib/storefront/listing-query";
import { cn } from "../cn";
import { ArrowRightIcon } from "../icons";

type PaginationProps = {
  page: number;
  pageCount: number;
  /** Link for a page number (sort and filter kept). */
  hrefFor: (page: number) => string;
};

const cell =
  "sf-focus sf-label inline-flex min-h-11 min-w-11 items-center justify-center rounded-[2px] border px-3 transition-colors duration-200";

/** Plain page links (work without JavaScript). Hidden for a single page. */
export function Pagination({ page, pageCount, hrefFor }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-14 flex flex-wrap items-center justify-center gap-2 border-t border-brand-ink/10! pt-8 lg:mt-20">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={cn(cell, "gap-2 border-brand-ink/20! bg-white text-brand-ink hover:border-brand-ink!")}>
          <ArrowRightIcon className="h-4 w-4 rotate-180" />
          <span className="hidden sm:inline">Previous</span>
          <span className="sr-only sm:hidden">Previous page</span>
        </Link>
      ) : null}
      <ol className="flex flex-wrap items-center gap-2">
        {pageWindow(page, pageCount).map((n, i) =>
          n === "gap" ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-brand-ink-soft">
              …
            </li>
          ) : (
            <li key={n}>
              {n === page ? (
                <span aria-current="page" className={cn(cell, "border-brand-ink! bg-brand-ink text-brand-cream")}>
                  <span className="sr-only">Page </span>
                  {n}
                </span>
              ) : (
                <Link href={hrefFor(n)} className={cn(cell, "border-brand-ink/20! bg-white text-brand-ink hover:border-brand-ink!")}>
                  <span className="sr-only">Page </span>
                  {n}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} rel="next" className={cn(cell, "gap-2 border-brand-ink/20! bg-white text-brand-ink hover:border-brand-ink!")}>
          <span className="hidden sm:inline">Next</span>
          <span className="sr-only sm:hidden">Next page</span>
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      ) : null}
    </nav>
  );
}
