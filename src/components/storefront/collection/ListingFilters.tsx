"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "../cn";
import { FilterBar, type FilterChip, type SortOption } from "../FilterBar";

type ListingFiltersProps = {
  /** Category chips; each links to its listing route. */
  chips: FilterChip[];
  activeChip: string;
  /** Only the sorts allowed for the products in view (no price sorts unless every price shows). */
  sortOptions: SortOption[];
  sort: string;
  /** Link for each sort value (current filter kept, back to page 1). */
  sortHrefs: Record<string, string>;
  hideSoldOut: boolean;
  /** Link that flips "Hide sold out" (current sort kept, back to page 1). */
  soldOutHref: string;
  resultLabel: string;
};

/**
 * The listing filter row (ZP-489) on the shared FilterBar: chips are plain
 * links, "Hide sold out" is a plain link, and the sort select navigates with
 * JavaScript. Without JavaScript a row of sort links shows instead, so every
 * control works from the URL alone.
 */
export function ListingFilters({
  chips,
  activeChip,
  sortOptions,
  sort,
  sortHrefs,
  hideSoldOut,
  soldOutHref,
  resultLabel,
}: ListingFiltersProps) {
  const router = useRouter();
  const toggle = (
    <Link
      href={soldOutHref}
      scroll={false}
      className="sf-focus sf-label group inline-flex min-h-11 items-center gap-2.5 rounded-[2px] text-brand-ink"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200",
          hideSoldOut ? "border-brand-olive! bg-brand-olive" : "border-brand-ink/30! bg-white group-hover:border-brand-ink!",
        )}
      >
        <span
          className={cn(
            "absolute h-3.5 w-3.5 rounded-full transition-transform duration-200",
            hideSoldOut ? "translate-x-[1.05rem] bg-white" : "translate-x-[0.15rem] bg-brand-ink/50",
          )}
        />
      </span>
      Hide sold out
      <span className="sr-only">{hideSoldOut ? " (on)" : " (off)"}</span>
    </Link>
  );

  return (
    <>
      <FilterBar
        chips={chips}
        activeChip={activeChip}
        sortOptions={sortOptions}
        sort={sort}
        onSortChange={(value) => {
          const href = sortHrefs[value];
          if (href) router.push(href, { scroll: false });
        }}
        resultLabel={resultLabel}
        extra={toggle}
      />
      <noscript>
        <nav aria-label="Sort" className="flex flex-wrap gap-x-5 gap-y-2 pt-3 text-sm">
          {sortOptions.map((o) => (
            <a
              key={o.value}
              href={sortHrefs[o.value]}
              aria-current={o.value === sort ? "true" : undefined}
              className={cn("underline-offset-4 hover:underline", o.value === sort ? "font-medium text-brand-ink" : "text-brand-olive-700")}
            >
              {o.label}
            </a>
          ))}
        </nav>
      </noscript>
    </>
  );
}
