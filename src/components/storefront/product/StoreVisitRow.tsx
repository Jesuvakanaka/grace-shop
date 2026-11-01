"use client";

// ZP-503: "Try it on in store" on the product page: a row that expands to
// today's hours, the week, the address and directions. The collapsed
// summary ("Open today 09:00–17:30") comes from the server render.
import { useId, useState } from "react";
import type { StoreVisit, TodayLine } from "@/lib/storefront/menu-model";
import { cn } from "../cn";
import { ChevronDownIcon } from "../icons";
import { VisitDetails } from "../VisitDetails";

export function StoreVisitRow({ visit, today }: { visit: StoreVisit; today: TodayLine | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="border-y border-brand-ink/10!">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="sf-focus flex min-h-[60px] w-full items-center justify-between gap-3 rounded-[2px] py-2 text-left text-brand-ink"
      >
        <span className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.16em]">Try it on in store</span>
          {today ? <span className="text-[13px] text-brand-ink-soft">{today.text}</span> : null}
        </span>
        <ChevronDownIcon className={cn("sf-motion h-5 w-5 shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div id={panelId} hidden={!open} className="pb-4">
        {open ? <VisitDetails visit={visit} showToday={false} /> : null}
      </div>
    </div>
  );
}
