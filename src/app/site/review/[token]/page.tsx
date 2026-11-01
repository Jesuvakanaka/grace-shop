import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Container } from "@/components/storefront";
import { ReviewForm } from "@/components/storefront/reviews/ReviewForm";
import prisma from "@/lib/db";
import { readReviewInvite } from "@/lib/reviews/invites";
import { buildWhatsAppLink, getPublicSiteSettings } from "@/lib/site-settings/public";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { TokenBucketLimiter, clientKey } from "@/lib/storefront/rate-limit";
import { getSiteBase } from "@/lib/storefront/site-base";

// ZP-508: /review/<token> (served at /site/review/<token> on the admin/UAT
// host), the one-time customer review form (design: Review.dc.html).
// Uncached and per request: the token decides everything. noindex, nocache
// and no-referrer, so the link never reaches search engines or other sites.
// An invalid, expired or used link shows a friendly page instead.
// See docs/storefront/reviews.md.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your review",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

/** Page views per client address: 30 in a burst, then one every 2 s (per instance). */
const limiter = new TokenBucketLimiter({ capacity: 30, refillPerSecond: 0.5 });

const LINK_PAGES = {
  invalid: {
    title: "This review link does not work",
    body: "It may have been copied incompletely. Ask us on WhatsApp and we will send you a new one.",
  },
  expired: {
    title: "This review link has expired",
    body: "Review links work for 30 days. Ask us on WhatsApp and we will gladly send you a new one.",
  },
  used: {
    title: "Thank you, we already have your review",
    body: "Each review link works once. Your review appears on the site once we have checked it.",
  },
  busy: {
    title: "Please try again in a moment",
    body: "This page was opened many times in a short while.",
  },
} as const;

export default async function ReviewPage({ params }: Props) {
  const [{ token }, h, settings, base] = await Promise.all([params, headers(), getPublicSiteSettings(), getSiteBase()]);
  const limited = !limiter.take(clientKey(h)).ok;
  const invite = limited ? null : await readReviewInvite(prisma, token);
  const whatsappHref = buildWhatsAppLink(settings);

  if (!invite || invite.state !== "open") {
    const page = LINK_PAGES[invite ? invite.state : "busy"];
    return (
      <Container className="py-16 sm:py-24">
        <div className="mx-auto flex max-w-md flex-col items-center gap-5 text-center">
          <h1 className="m-0 font-serif text-[32px] font-medium leading-tight">{page.title}</h1>
          <p className="m-0 text-[15px] leading-relaxed text-brand-ink-soft">{page.body}</p>
          {whatsappHref && invite?.state !== "used" ? (
            <a
              href={whatsappHref}
              className="sf-focus inline-flex min-h-[52px] w-full items-center justify-center rounded-[2px] bg-brand-olive px-6 text-[13px] font-medium uppercase tracking-[0.14em] text-white hover:bg-brand-olive-700"
            >
              Ask on WhatsApp
            </a>
          ) : null}
          <Link
            href={sitePath(base, SITE_ROUTES.home)}
            className="sf-focus inline-flex min-h-11 items-center rounded-[2px] text-sm text-brand-olive-700 underline underline-offset-4"
          >
            See the collection
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <ReviewForm
      token={token}
      piece={invite.product}
      nameHint={invite.customerHint}
      googleReviewUrl={settings.reviews.googleReviewUrl}
      homeHref={sitePath(base, SITE_ROUTES.home)}
    />
  );
}
