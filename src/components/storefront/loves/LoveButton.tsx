"use client";

// ZP-507: the "Love it" heart. A real button, aria-pressed, named
// "Love <piece name>" plus the visible text (loveButtonLabel). "rail": the round feed control (above the eye, also in
// clean view) with "Love" or the number (from 3) under it. "pill": the
// product page's "Love it" / "Loved by 24" next to the price.
// Loving pops the heart once (no animation with reduced motion).
// State and the server call: src/lib/loves/client.ts.
import { useState } from "react";
import { feedLoveText, loveButtonLabel, productLoveText } from "@/lib/loves/model";
import { useLove } from "@/lib/loves/client";
import { cn } from "../cn";

const HEART = "M12 20s-7-4.4-9.2-8.6C1.3 8.4 3 5 6.4 5c2 0 3.6 1.2 4.6 2.6C12 6.2 13.6 5 15.6 5 19 5 20.7 8.4 19.2 11.4 17 15.6 12 20 12 20z";

function Heart({ filled, className, pop }: { filled: boolean; className: string; pop: number }) {
  return (
    // A new key per love replays the pop.
    <span key={pop} className={cn("inline-flex", pop > 0 && "motion-safe:animate-[sf-heart-pop_360ms_ease-out]")}>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className={className}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={HEART} />
      </svg>
    </span>
  );
}

type LoveButtonProps = {
  slug: string;
  name: string;
  /** The cached server count (PublicProduct.loves). */
  loves: number | undefined;
  variant: "rail" | "pill";
  className?: string;
};

export function LoveButton({ slug, name, loves: serverLoves, variant, className }: LoveButtonProps) {
  const { loved, loves, toggle } = useLove(slug, serverLoves);
  const [pop, setPop] = useState(0);
  // The name contains the visible text ("Love <name>, loved by 24"); see loveButtonLabel.
  const label = loveButtonLabel(variant, name, loves);
  const onClick = () => {
    if (!loved) setPop((n) => n + 1);
    toggle();
  };

  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={loved}
        aria-label={label}
        data-love-button=""
        className={cn("sf-focus flex flex-col items-center gap-1.5 rounded-[2px] text-brand-cream-50", className)}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-cream-50/25 bg-[rgba(20,20,18,0.45)]">
          <Heart filled={loved} pop={pop} className="h-[22px] w-[22px]" />
        </span>
        <span className="text-[11px] font-medium tracking-[0.06em] [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
          {feedLoveText(loves)}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={loved}
      aria-label={label}
      data-love-button=""
      className={cn(
        "sf-focus inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-ink/25! px-3.5 text-[13px] text-brand-ink transition-colors duration-200 hover:border-brand-ink!",
        className,
      )}
    >
      <Heart filled={loved} pop={pop} className={cn("h-[18px] w-[18px]", loved ? "text-brand-olive" : "text-brand-ink")} />
      <span>{productLoveText(loves)}</span>
    </button>
  );
}
