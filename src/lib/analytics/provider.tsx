"use client";

// ZP-493: starts first-party analytics on every storefront page
// (src/app/site/layout.tsx). It only sends visit_start (once per visit) and
// visit_end (when the page hides); everything else is tracked by the
// components with track() / useDwell() from @/lib/analytics/client.
// Renders nothing of its own. Disabled for GPC / DNT, automated browsers
// and preview pages (see src/lib/analytics/client-core.ts).
import { useEffect, type ReactNode } from "react";
import { initAnalytics } from "./client";

export function AnalyticsProvider({ children }: { children?: ReactNode }) {
  useEffect(() => {
    initAnalytics();
  }, []);
  return children ?? null;
}
