import type { Metadata } from "next";
import { SiteBaseProvider } from "@/components/storefront";
import { SimpleTopBar } from "@/components/storefront/SimpleTopBar";
import { StorefrontFrame } from "@/components/storefront/feed/StorefrontFrame";
import { ShellMenuProvider } from "@/components/storefront/ShellMenu";
import { getMenuData } from "@/lib/storefront/menu-data";
import { getShellData } from "@/lib/storefront/shell";
import { AnalyticsProvider } from "@/lib/analytics/provider";

// ZP-487: the VYRA storefront shell. Served at /site/** on the admin/UAT host
// and at clean paths on a storefront host (src/proxy.ts). It sits outside
// src/app/(admin), so there is no AuthProvider / AppShell: no session fetch,
// no login screen, no admin chrome. Fonts (Cormorant Garamond, Jost) and
// globals.css come from the root layout.
//
// Landmarks: skip link, <main id="main">; ZP-514: the few pages that are
// not the feed (privacy, review form, 404) get a simple top bar (wordmark +
// "Back to the looks"), no header navigation and no footer. Reads the request host for link prefixing, so storefront
// pages render dynamically; their data comes from the cached reads.
//
// ZP-500: the landing page (/) is a full-screen feed with no header or
// footer; StorefrontFrame decides that from the selected layout segment.
export const metadata: Metadata = {
  title: {
    template: "%s – VYRA",
    default: "VYRA – Wear Different.",
  },
  description: "VYRA. Wear different. Premium fashion, in store and on WhatsApp.",
  // Not launched yet: keep every storefront page out of search engines.
  robots: { index: false, follow: false },
};

export default async function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [shell, menu] = await Promise.all([getShellData(), getMenuData()]);
  return (
    <SiteBaseProvider base={shell.base}>
      {/* ZP-493: first-party, anonymous analytics (visit_start / visit_end). See /privacy. */}
      <AnalyticsProvider />
      {/* ZP-503: the menu's content for the header and the landing feed. */}
      <ShellMenuProvider menu={menu}>
        <StorefrontFrame
          skipLink={
            <a
              href="#main"
              className="sf-focus sf-label sr-only z-50 bg-brand-ink px-4 py-4 text-brand-cream focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:inline-flex focus:min-h-11 focus:items-center"
            >
              Skip to content
            </a>
          }
          header={<SimpleTopBar homeHref={shell.homeHref} />}
        >
          {children}
        </StorefrontFrame>
      </ShellMenuProvider>
    </SiteBaseProvider>
  );
}
