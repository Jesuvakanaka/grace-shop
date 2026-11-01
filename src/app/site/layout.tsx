import type { Metadata } from "next";
import { Footer, Header, SiteBaseProvider } from "@/components/storefront";
import { getShellData } from "@/lib/storefront/shell";

// ZP-487: the VYRA storefront shell. Served at /site/** on the admin/UAT host
// and at clean paths on a storefront host (src/proxy.ts). It sits outside
// src/app/(admin), so there is no AuthProvider / AppShell: no session fetch,
// no login screen, no admin chrome. Fonts (Cormorant Garamond, Jost) and
// globals.css come from the root layout.
//
// Landmarks: skip link, <header> (banner), <main id="main">, <footer>
// (contentinfo). Reads the request host for link prefixing, so storefront
// pages render dynamically; their data comes from the cached reads.
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
  const shell = await getShellData();
  return (
    <SiteBaseProvider base={shell.base}>
      <div className="flex min-h-screen flex-col bg-brand-cream text-brand-ink">
        <a
          href="#main"
          className="sf-focus sf-label sr-only z-50 bg-brand-ink px-4 py-4 text-brand-cream focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:inline-flex focus:min-h-11 focus:items-center"
        >
          Skip to content
        </a>
        <Header nav={shell.nav} homeHref={shell.homeHref} whatsappHref={shell.whatsappHref} social={shell.social} />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
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
      </div>
    </SiteBaseProvider>
  );
}
