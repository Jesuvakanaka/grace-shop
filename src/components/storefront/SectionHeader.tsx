import type { ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "./cn";

type SectionHeaderProps = {
  title: string;
  /** Optional short line under the title. */
  intro?: ReactNode;
  /** Optional "VIEW ALL →" link. */
  action?: { label: string; href: string };
  /** Heading level. Sections are h2 by default. */
  as?: "h1" | "h2" | "h3";
  align?: "left" | "center";
  /** Drop the bottom margin (when the header sits inside a column with its own gap). */
  flush?: boolean;
  id?: string;
  className?: string;
};

/** The 40×3px lime rule, a serif title, and an optional "VIEW ALL →" link. */
export function SectionHeader({
  title,
  intro,
  action,
  as: Heading = "h2",
  align = "left",
  flush = false,
  id,
  className,
}: SectionHeaderProps) {
  const centred = align === "center";
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        !flush && "mb-8 lg:mb-12",
        !centred && "sm:flex-row sm:items-end sm:justify-between",
        centred && "items-center text-center",
        className,
      )}
    >
      <div className={cn("flex flex-col gap-4", centred && "items-center")}>
        <span className="sf-rule" aria-hidden="true" />
        <Heading id={id} className="sf-title text-balance">
          {title}
        </Heading>
        {intro ? <p className="sf-body text-brand-ink-soft">{intro}</p> : null}
      </div>
      {action ? (
        <Button variant="link" href={action.href} className="self-start sm:self-auto">
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
