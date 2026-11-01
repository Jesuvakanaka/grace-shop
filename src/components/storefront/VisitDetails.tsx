"use client";

// ZP-503: the shop's visit details as shown inside the menu's "Visit us" row
// and the product page's "Try it on in store" row: today's hours
// (highlighted), the week, holiday note, address and directions. Every part
// is hidden when not set. Render it only once its row is open (in the
// browser), so "today" is the visitor's current day in the shop's time zone.
import { todayLine, type StoreVisit } from "@/lib/storefront/menu-model";
import { cn } from "./cn";

export function VisitDetails({ visit, showToday = true }: { visit: StoreVisit; showToday?: boolean }) {
  const today = showToday ? todayLine(visit.hours, new Date()) : null;
  return (
    <div className="flex flex-col gap-1.5 text-sm text-brand-ink-soft">
      {today ? (
        <p className={cn("font-medium", today.open ? "text-brand-olive-700" : "text-brand-ink")}>{today.text}</p>
      ) : null}
      {visit.week.length > 0 ? (
        <ul aria-label="Opening hours" className="flex flex-col gap-1">
          {visit.week.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {visit.holidayNote ? <p>{visit.holidayNote}</p> : null}
      {visit.address.length > 0 ? (
        <address className="pt-1 not-italic">
          {visit.address.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
      ) : null}
      {visit.directionsHref ? (
        <a
          href={visit.directionsHref}
          // ZP-493: counted as `directions` where a page listens (the product page, ProductTracking).
          data-track="directions"
          target="_blank"
          rel="noopener noreferrer"
          className="sf-focus sf-label inline-flex min-h-11 w-fit items-center rounded-[2px] text-brand-ink underline decoration-brand-ink/30 underline-offset-4 hover:decoration-brand-ink"
        >
          Get directions<span className="sr-only"> (opens Google Maps in a new tab)</span>
        </a>
      ) : null}
    </div>
  );
}
