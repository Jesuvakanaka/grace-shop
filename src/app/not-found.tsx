import type { Metadata } from "next";
import Link from "next/link";

// Neutral title: the root layout's back-office title must not show on the storefront.
export const metadata: Metadata = {
  title: "Page not found – VYRA",
  robots: { index: false, follow: false },
};

// ZP-485: the one 404 page for both front doors (storefront and back office).
// It renders in the bare root layout, so it must not need any provider.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand-cream px-6 py-16 text-center text-brand-ink">
      <p className="text-sm font-medium uppercase tracking-[0.3em] text-brand-ink-soft">404</p>
      <h1 className="font-serif text-3xl font-semibold sm:text-4xl">This page can&apos;t be found</h1>
      <Link
        href="/"
        className="rounded-full bg-brand-olive px-6 py-3 text-sm font-medium text-white hover:bg-brand-olive-700"
      >
        Go to the home page
      </Link>
    </main>
  );
}
