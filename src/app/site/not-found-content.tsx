"use client";

import { NotFoundState, useSitePath } from "@/components/storefront";
import { SITE_ROUTES } from "@/lib/storefront/paths";

/** "This piece has moved on." with links to New Arrivals and Home for this host. */
export function StorefrontNotFoundContent() {
  const to = useSitePath();
  return (
    <>
      {/* Next 16.4 renders a notFound() page on the client (the response is
          still a 404), where the segment metadata title is not re-applied.
          React 19 hoists this <title> into <head>. */}
      <title>Page not found – VYRA</title>
      <NotFoundState
        title="This piece has moved on."
        message="It may have sold, or the link has changed. Take a look at what's new instead."
        action={{ label: "See new arrivals", href: to(SITE_ROUTES.newArrivals) }}
        secondaryAction={{ label: "Back to home", href: to(SITE_ROUTES.home) }}
        className="sm:py-32"
      />
    </>
  );
}
