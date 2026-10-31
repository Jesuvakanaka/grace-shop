import { Button } from "./Button";
import { cn } from "./cn";
import { Mark } from "./Brand";

type ColourBlockProps = {
  /** Lime takes ink text and an ink button; olive takes white text and a cream button. */
  tone?: "lime" | "olive";
  statement: string;
  /** Optional small label above the statement. */
  eyebrow?: string;
  action?: { label: string; href: string };
  id?: string;
  className?: string;
};

/** Full-bleed colour-block section with one serif statement and one button. Use sparingly. */
export function ColourBlock({ tone = "lime", statement, eyebrow, action, id, className }: ColourBlockProps) {
  const lime = tone === "lime";
  return (
    <section
      id={id}
      className={cn(
        "relative isolate overflow-hidden py-20 sm:py-24 lg:py-32",
        lime ? "bg-brand-lime text-brand-ink" : "bg-brand-olive text-white",
        className,
      )}
    >
      <Mark
        tone="mono"
        className={cn(
          "pointer-events-none absolute -right-16 top-1/2 -z-10 h-[140%] w-auto -translate-y-1/2 sm:-right-8",
          lime ? "text-brand-ink/[0.06]" : "text-white/[0.07]",
        )}
      />
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-8 px-4 text-center sm:px-6 lg:px-8">
        {eyebrow ? <p className="sf-label">{eyebrow}</p> : null}
        <h2 className="sf-display max-w-[16ch] text-balance">{statement}</h2>
        {action ? (
          <Button href={action.href} variant={lime ? "ink" : "cream"} arrow>
            {action.label}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
