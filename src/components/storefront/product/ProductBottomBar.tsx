"use client";

// ZP-503: the pinned bottom bar on phones. "Enquire on WhatsApp" (olive; "Ask
// about restock" when sold out) with the chosen colour and size, plus a Call
// icon button when a phone number is set. Without a WhatsApp number the main
// button is "Visit us". Render it as the last child of the product <article>:
// it stays pinned while the article is on screen and never covers the footer.
import Link from "next/link";
import { WhatsAppIcon } from "../icons";
import { useEnquiry } from "./ProductEnquiry";

const primary =
  "sf-focus flex min-h-[52px] flex-1 items-center justify-center gap-2.5 rounded-[2px] bg-brand-olive px-4 text-[13px] font-medium uppercase tracking-[0.14em] text-white transition-colors duration-200 hover:bg-brand-olive-700";

function PhoneIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export function ProductBottomBar({ tel, visitHref }: { tel: string | null; visitHref: string }) {
  const { href, label } = useEnquiry();
  return (
    <div className="sticky bottom-0 z-30 flex gap-2.5 border-t border-brand-ink/10! bg-brand-cream-50 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 lg:hidden">
      {href ? (
        <a href={href} className={primary}>
          <WhatsAppIcon className="h-5 w-5 shrink-0" />
          {label}
        </a>
      ) : (
        <Link href={visitHref} className={primary}>
          Visit us
        </Link>
      )}
      {tel ? (
        <a
          href={tel}
          aria-label="Call the shop"
          className="sf-focus inline-flex min-h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[2px] border border-brand-ink! text-brand-ink transition-colors duration-200 hover:bg-brand-ink hover:text-brand-cream-50"
        >
          <PhoneIcon />
        </a>
      ) : null}
    </div>
  );
}
