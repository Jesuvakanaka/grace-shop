"use client";

// ZP-493: starts first-party analytics on every storefront page
// (src/app/site/layout.tsx). It only sends visit_start (once per visit) and
// visit_end (when the page hides); everything else is tracked by the
// components with track() / useDwell() from @/lib/analytics/client.
// Renders nothing of its own. Disabled for GPC / DNT, automated browsers
// and preview pages (see src/lib/analytics/client-core.ts).
// ZP-508: never started on the one-time review page (/review/<token>): its
// URL holds a live token. Any event that still happens there (an analytics
// client started on an earlier page) records the page as "/review" only.
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { initAnalytics } from "./client";
import { isPrivatePagePath } from "./events";

export function AnalyticsProvider({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const skip = isPrivatePagePath(pathname ?? "");
  useEffect(() => {
    if (!skip) initAnalytics();
  }, [skip]);
  return children ?? null;
}
