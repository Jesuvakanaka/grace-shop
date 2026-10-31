import type { Metadata } from "next";

// ZP-485: minimal VYRA storefront layout. Served at /site/** on the admin/UAT
// host (owner preview) and at clean paths on the storefront host (src/proxy.ts).
// It sits outside src/app/(admin), so there is no AuthProvider / AppShell: no
// session fetch, no login screen, no admin chrome. ZP-487 replaces the shell.
export const metadata: Metadata = {
  title: {
    template: "%s – VYRA",
    default: "VYRA – Wear Different",
  },
  description: "VYRA – Wear Different.",
  // Not launched yet: keep every storefront page out of search engines.
  robots: { index: false, follow: false },
};

export default function StorefrontLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-brand-cream text-brand-ink">
      <main id="main" className="min-h-screen">
        {children}
      </main>
    </div>
  );
}
