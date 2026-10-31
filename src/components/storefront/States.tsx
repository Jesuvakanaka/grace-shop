import type { ReactNode } from "react";
import { Mark } from "./Brand";
import { Button } from "./Button";
import { cn } from "./cn";

type StateProps = {
  title: string;
  message?: ReactNode;
  action?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  /** Heading level: h1 when the state is the whole page (404), else h2. */
  as?: "h1" | "h2";
  className?: string;
};

function StateBlock({ title, message, action, secondaryAction, as: Heading = "h2", className, role }: StateProps & { role?: "alert" }) {
  return (
    <div role={role} className={cn("mx-auto flex max-w-xl flex-col items-center gap-5 px-4 py-16 text-center sm:py-24", className)}>
      <Mark className="h-14 w-14" />
      <span className="sf-rule" aria-hidden="true" />
      <Heading className="sf-title text-balance text-brand-ink">{title}</Heading>
      {message ? <p className="sf-body text-brand-ink-soft">{message}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
          {action ? (
            <Button href={action.href} variant="primary" arrow>
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button href={secondaryAction.href} variant="ghost">
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Nothing to show yet (empty filter, empty collection). */
export function EmptyState({
  title = "Nothing here yet",
  message = "New pieces arrive often. Check back soon, or ask us on WhatsApp.",
  ...rest
}: Partial<StateProps>) {
  return <StateBlock title={title} message={message} {...rest} />;
}

/** Something went wrong loading the page. */
export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this page. Please try again in a moment.",
  ...rest
}: Partial<StateProps>) {
  return <StateBlock title={title} message={message} role="alert" {...rest} />;
}

/** 404: "This piece has moved on." */
export function NotFoundState({
  title = "This piece has moved on.",
  message = "It may have sold, or the link has changed. Take a look at what's new instead.",
  as = "h1",
  ...rest
}: Partial<StateProps>) {
  return <StateBlock title={title} message={message} as={as} {...rest} />;
}
