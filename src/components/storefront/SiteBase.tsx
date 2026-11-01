"use client";

import { createContext, useContext, type ReactNode } from "react";
import { sitePath, type SiteBase } from "@/lib/storefront/paths";

// ZP-487: the storefront link base ("/site" or "") for client components.
// src/app/site/layout.tsx provides it from getSiteBase(); client components
// (error.tsx, filters, galleries) read it here instead of guessing from the URL.
const SiteBaseContext = createContext<SiteBase>("/site");

export function SiteBaseProvider({ base, children }: { base: SiteBase; children: ReactNode }) {
  return <SiteBaseContext.Provider value={base}>{children}</SiteBaseContext.Provider>;
}

/** "/site" on the admin/UAT host, "" on a storefront host. */
export function useSiteBase(): SiteBase {
  return useContext(SiteBaseContext);
}

/** `sitePath` bound to the current base: `const to = useSitePath(); to("/shop")`. */
export function useSitePath(): (path: string) => string {
  const base = useSiteBase();
  return (path: string) => sitePath(base, path);
}
