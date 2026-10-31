import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";
import { ArrowRightIcon } from "./icons";

export type ButtonVariant =
  /** Olive with white text (4.89:1). The one main action per view. */
  | "primary"
  /** Transparent with a 1px ink border and ink text. Secondary action on cream/white. */
  | "ghost"
  /** Ghost for dark or olive grounds: white border and text. */
  | "ghost-light"
  /** Ink with cream text. The action on a lime colour block. */
  | "ink"
  /** Cream with ink text. The action on an olive or ink block. */
  | "cream"
  /** Text link in olive-700 with an arrow ("VIEW ALL →"). */
  | "link";

const base =
  "sf-focus sf-motion inline-flex min-h-11 items-center justify-center gap-3 rounded-[2px] font-sans text-[0.8125rem] font-medium uppercase leading-none tracking-[0.18em] transition-colors duration-200 ease-out select-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-olive px-7 py-4 text-white hover:bg-brand-olive-700",
  ghost: "border border-brand-ink! px-7 py-4 text-brand-ink hover:bg-brand-ink hover:text-brand-cream",
  "ghost-light": "border border-white! px-7 py-4 text-white hover:bg-white hover:text-brand-ink",
  ink: "bg-brand-ink px-7 py-4 text-brand-cream hover:bg-black",
  cream: "bg-brand-cream px-7 py-4 text-brand-ink hover:bg-white",
  link: "min-h-11 px-0 text-brand-olive-700 underline-offset-[6px] hover:underline",
};

type CommonProps = {
  variant?: ButtonVariant;
  /** Show the trailing arrow ("SHOP THE COLLECTION →"). Default on for "link". */
  arrow?: boolean;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
};

type AsLink = CommonProps & { href: string } & Omit<ComponentPropsWithoutRef<"a">, "href" | "className" | "children">;
type AsButton = CommonProps & { href?: undefined } & Omit<ComponentPropsWithoutRef<"button">, "className" | "children">;

export function buttonClasses(variant: ButtonVariant = "primary", fullWidth = false, className?: string) {
  return cn(base, variants[variant], fullWidth && "w-full", className);
}

export function Button({
  variant = "primary",
  arrow,
  fullWidth = false,
  className,
  children,
  ...rest
}: AsLink | AsButton) {
  const showArrow = arrow ?? variant === "link";
  const content = (
    <>
      <span>{children}</span>
      {showArrow ? <ArrowRightIcon className="h-4 w-4 shrink-0" /> : null}
    </>
  );
  const classes = buttonClasses(variant, fullWidth, className);

  if (rest.href !== undefined) {
    const { href, ...anchorProps } = rest as Omit<AsLink, keyof CommonProps>;
    return (
      <Link href={href} className={classes} {...anchorProps}>
        {content}
      </Link>
    );
  }
  const { type = "button", ...buttonProps } = rest as Omit<AsButton, keyof CommonProps>;
  return (
    <button type={type} className={classes} {...buttonProps}>
      {content}
    </button>
  );
}
