import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import "./globals.css";

// VYRA type: high-contrast serif for headings, geometric sans for body and labels.
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cormorant",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VYRA - Stock, Cash & Credit",
  description: "VYRA business control: stock, cash, debtors, creditors and daily operations.",
  applicationName: "VYRA",
  appleWebApp: { title: "VYRA" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#5F7A1F",
};

// ZP-485: shared shell only (html, fonts, globals.css). Each front door adds its
// own wrapper: src/app/(admin)/layout.tsx (session, login screen, admin chrome)
// and src/app/site/layout.tsx (public storefront, no session fetch).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jost.variable} ${cormorant.variable}`}>
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}
