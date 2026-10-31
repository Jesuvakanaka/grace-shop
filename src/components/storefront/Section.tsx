import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

/** Centred column, max 1200px, 16px gutters on phones, 24-32px on larger screens. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export type SectionTone = "cream" | "cream-light" | "white" | "lime" | "olive" | "ink";

const tones: Record<SectionTone, string> = {
  cream: "bg-brand-cream text-brand-ink",
  "cream-light": "bg-brand-cream-100 text-brand-ink",
  white: "bg-white text-brand-ink",
  lime: "bg-brand-lime text-brand-ink",
  olive: "bg-brand-olive text-white",
  ink: "bg-brand-ink text-brand-cream",
};

const spacing = {
  /** 48-64px on mobile, 96-120px on desktop. */
  default: "py-14 sm:py-16 lg:py-24 xl:py-28",
  /** 32-40px on mobile, 64px on desktop: strips and teasers. */
  compact: "py-8 sm:py-10 lg:py-16",
  none: "",
};

type SectionProps = {
  tone?: SectionTone;
  spacing?: keyof typeof spacing;
  /** Wrap children in a Container. Turn off for full-bleed content. */
  contained?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"section">, "className" | "children">;

export function Section({
  tone = "cream",
  spacing: space = "default",
  contained = true,
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section className={cn(tones[tone], spacing[space], className)} {...rest}>
      {contained ? <Container>{children}</Container> : children}
    </section>
  );
}
