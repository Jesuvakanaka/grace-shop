import { notFound } from "next/navigation";

// ZP-487: an unknown storefront URL (/site/xyz, or /xyz on a storefront host)
// renders the storefront 404 (../not-found.tsx) inside the storefront shell,
// instead of falling through to the admin's root 404. Real pages are static
// segments, which always win over this catch-all.
export default function UnknownStorefrontPage(): never {
  notFound();
}
