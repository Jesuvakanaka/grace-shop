// ZP-508: the VYRA shop rating box ("4.8 ★★★★★ Rated 4.8 out of 5 by 36
// verified customers"), on the product page and in the menu. Null-safe: no
// summary, no box.
import { formatAverage, shopRatingLine, starsText, type RatingSummary } from "@/lib/reviews/aggregate";
import { cn } from "../cn";

export function ShopRatingBox({
  summary,
  variant,
  className,
}: {
  summary: RatingSummary | null;
  /** product: cream-200 box, "VYRA shop rating, from N verified customers"; menu: cream-100, the full sentence. */
  variant: "product" | "menu";
  className?: string;
}) {
  const line = shopRatingLine(summary);
  if (!summary || !line) return null;
  const text =
    variant === "product"
      ? `VYRA shop rating, from ${summary.count} verified ${summary.count === 1 ? "customer" : "customers"}`
      : line;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[2px] text-[13px] text-brand-ink-soft",
        variant === "product" ? "bg-brand-cream-200 px-3.5 py-3" : "bg-brand-cream-100 px-4 py-3.5",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("font-serif font-semibold leading-none text-brand-ink", variant === "product" ? "text-[30px]" : "text-[34px]")}
      >
        {formatAverage(summary.average)}
      </span>
      <span className="flex flex-col gap-0.5">
        <span aria-hidden="true" className="tracking-[0.06em] text-brand-olive-700">
          {starsText(summary.average)}
        </span>
        <span aria-hidden="true">{text}</span>
        <span className="sr-only">{line}</span>
      </span>
    </div>
  );
}
