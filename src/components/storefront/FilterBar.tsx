"use client";

import { useId, useState } from "react";
import { cn } from "./cn";
import { ChevronDownIcon } from "./icons";

export type FilterChip = { label: string; value: string };
export type SortOption = { label: string; value: string };

type FilterBarProps = {
  chips: FilterChip[];
  /** Selected chip value. Uncontrolled (local state) when `onChipChange` is missing. */
  activeChip?: string;
  onChipChange?: (value: string) => void;
  sortOptions: SortOption[];
  sort?: string;
  onSortChange?: (value: string) => void;
  /** e.g. "24 pieces". */
  resultLabel?: string;
  className?: string;
};

/**
 * Presentational filter row: scrollable chips plus a sort control. It holds no
 * data; the page (ZP-484 data layer) decides what a chip or sort does.
 */
export function FilterBar({
  chips,
  activeChip,
  onChipChange,
  sortOptions,
  sort,
  onSortChange,
  resultLabel,
  className,
}: FilterBarProps) {
  const sortId = useId();
  const [localChip, setLocalChip] = useState(activeChip ?? chips[0]?.value);
  const [localSort, setLocalSort] = useState(sort ?? sortOptions[0]?.value);
  const current = onChipChange ? activeChip : localChip;
  const currentSort = onSortChange ? sort : localSort;

  return (
    <div className={cn("flex flex-col gap-4 border-y border-brand-ink/10! py-4 md:flex-row md:items-center md:justify-between md:gap-6", className)}>
      <div role="group" aria-label="Filter by category" className="sf-scroll-x -mx-4 min-w-0 px-4 py-1 md:mx-0 md:px-1 lg:overflow-visible">
        <ul className="flex w-max gap-2 lg:w-auto lg:flex-wrap">
          {chips.map((chip) => {
            const active = chip.value === current;
            return (
              <li key={chip.value}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => (onChipChange ? onChipChange(chip.value) : setLocalChip(chip.value))}
                  className={cn(
                    "sf-focus sf-label inline-flex min-h-11 items-center whitespace-nowrap rounded-[2px] border px-4 transition-colors lg:px-3.5 duration-200",
                    active
                      ? "border-brand-ink! bg-brand-ink text-brand-cream"
                      : "border-brand-ink/20! bg-white text-brand-ink hover:border-brand-ink!",
                  )}
                >
                  {chip.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-6 md:justify-end">
        {resultLabel ? (
          <p className="text-sm text-brand-ink-soft" aria-live="polite">
            {resultLabel}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <label htmlFor={sortId} className="sf-label text-brand-ink-soft">
            Sort
          </label>
          <div className="relative">
            <select
              id={sortId}
              value={currentSort}
              onChange={(e) => (onSortChange ? onSortChange(e.target.value) : setLocalSort(e.target.value))}
              className="sf-focus sf-label min-h-11 cursor-pointer appearance-none rounded-[2px] border border-brand-ink/20! bg-white py-2 pl-4 pr-10 text-brand-ink hover:border-brand-ink!"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-ink" />
          </div>
        </div>
      </div>
    </div>
  );
}
