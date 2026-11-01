"use client";

import { Button, ErrorState, useSitePath } from "@/components/storefront";
import { SITE_ROUTES } from "@/lib/storefront/paths";

// ZP-487: storefront error boundary (inside the shell, so the header and
// footer stay). It never shows the error message, digest or stack: shoppers
// get a calm message and a way out. The details are in the server logs.
export default function StorefrontError({ retry }: { error: unknown; retry?: () => void }) {
  const to = useSitePath();
  return (
    <div className="flex flex-col items-center pb-16 sm:pb-24">
      <ErrorState
        title="Something went wrong"
        message="We couldn't load this page. Please try again in a moment."
        className="pb-6 sm:pb-8"
      />
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        {retry ? (
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
        ) : null}
        <Button href={to(SITE_ROUTES.home)} variant="ghost">
          Back to home
        </Button>
      </div>
    </div>
  );
}
