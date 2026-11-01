import type { Metadata } from "next";
import { Footer, Header, SiteBaseProvider } from "@/components/storefront";
import { StorefrontFrame } from "@/components/storefront/feed/StorefrontFrame";
import { NavMemory } from "@/components/storefront/product/NavMemory";
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
// Landmarks: skip link, <header> (banner), <main id="main">, <footer>
// (contentinfo). Reads the request host for link prefixing, so storefront
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
      {/* ZP-503: the menu's content for the header and the landing feed; NavMemory feeds the product page's back button. */}
      <ShellMenuProvider menu={menu}>
        <NavMemory />
        <StorefrontFrame
          skipLink={
            <a
              href="#main"
              className="sf-focus sf-label sr-only z-50 bg-brand-ink px-4 py-4 text-brand-cream focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:inline-flex focus:min-h-11 focus:items-center"
            >
              Skip to content
            </a>
          }
          header={
            <Header nav={shell.nav} homeHref={shell.homeHref} whatsappHref={shell.whatsappHref} social={shell.social} />
          }
          footer={
            <Footer
              tagline={shell.tagline}
              address={shell.address}
              hours={shell.hours}
              holidayNote={shell.holidayNote}
              phone={shell.phone}
              email={shell.email}
              whatsappHref={shell.whatsappHref}
              columns={shell.footerColumns}
              social={shell.social}
              homeHref={shell.homeHref}
              year={new Date().getFullYear()}
            />
          }
        >
          {children}
        </StorefrontFrame>
      </ShellMenuProvider>
    </SiteBaseProvider>
  );
}
