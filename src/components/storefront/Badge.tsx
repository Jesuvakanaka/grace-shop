import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone =
  /** Lime with ink text (6.97:1): "NEW". */
  | "lime"
  /** White with ink text and a hairline: "FEW LEFT". */
  | "light"
  /** Ink with cream text: "SOLD OUT". */
  | "ink";

const tones: Record<BadgeTone, string> = {
  lime: "bg-brand-lime text-brand-ink",
  light: "bg-white text-brand-ink ring-1 ring-inset ring-brand-ink/10",
  ink: "bg-brand-ink text-brand-cream",
};

export function Badge({
  tone = "lime",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] px-2.5 py-1.5 font-sans text-xs font-medium uppercase leading-none tracking-[0.2em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
