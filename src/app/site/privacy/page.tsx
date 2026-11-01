import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/storefront";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { getShellData } from "@/lib/storefront/shell";

// ZP-487: short, plain-language privacy notice. Contact details come from the
// site settings and only show when set.
export const metadata: Metadata = {
  title: "Privacy",
  description: "How the VYRA website handles your information.",
};

const link = "sf-focus rounded-[2px] text-brand-olive-700 underline underline-offset-4 hover:text-brand-ink";

export default async function PrivacyPage() {
  const shell = await getShellData();
  const hasContact = Boolean(shell.whatsappHref || shell.phone || shell.email || shell.address.length);

  return (
    <Container className="py-14 sm:py-16 lg:py-24">
      <article className="mx-auto flex max-w-[44rem] flex-col gap-10">
        <header className="flex flex-col gap-5">
          <span className="sf-rule" aria-hidden="true" />
          <h1 className="sf-display text-balance">Privacy</h1>
          <p className="sf-body text-lg text-brand-ink-soft">
            The short version: this website does not ask for your name, email or payment details, and it does not
            track you across other sites.
          </p>
        </header>

        <section aria-labelledby="privacy-visits" className="flex flex-col gap-3 border-t border-brand-ink/10! pt-8">
          <h2 id="privacy-visits" className="sf-title">
            Visiting the site
          </h2>
          <p className="sf-body text-brand-ink-soft">
            Like most websites, our server keeps standard technical logs (such as your IP address, browser type and the
            pages requested) to keep the site secure and working. We don&apos;t use analytics, advertising trackers or
            cookies that follow you. There are no accounts and no shopping cart on this site.
          </p>
        </section>

        <section aria-labelledby="privacy-whatsapp" className="flex flex-col gap-3 border-t border-brand-ink/10! pt-8">
          <h2 id="privacy-whatsapp" className="sf-title">
            Enquiries on WhatsApp
          </h2>
          <p className="sf-body text-brand-ink-soft">
            When you tap an &ldquo;Enquire on WhatsApp&rdquo; button, WhatsApp opens with a message ready for you to
            send. Nothing is sent until you press send. Your conversation with us then happens on WhatsApp, under
            WhatsApp&apos;s own terms and privacy policy. We only use what you tell us to answer your enquiry.
          </p>
        </section>

        <section aria-labelledby="privacy-contact" className="flex flex-col gap-3 border-t border-brand-ink/10! pt-8">
          <h2 id="privacy-contact" className="sf-title">
            Questions
          </h2>
          {hasContact ? (
            <>
              <p className="sf-body text-brand-ink-soft">If you have a question about your information, talk to us:</p>
              <ul className="sf-body flex flex-col gap-2 text-brand-ink">
                {shell.whatsappHref ? (
                  <li>
                    WhatsApp:{" "}
                    <a href={shell.whatsappHref} className={link}>
                      send us a message
                    </a>
                  </li>
                ) : null}
                {shell.phone ? (
                  <li>
                    Phone:{" "}
                    <a href={`tel:${shell.phone.replace(/[^\d+]/g, "")}`} className={link}>
                      {shell.phone}
                    </a>
                  </li>
                ) : null}
                {shell.email ? (
                  <li>
                    Email:{" "}
                    <a href={`mailto:${shell.email}`} className={link}>
                      {shell.email}
                    </a>
                  </li>
                ) : null}
                {shell.address.length ? <li>In store: {shell.address.join(", ")}</li> : null}
              </ul>
            </>
          ) : (
            <p className="sf-body text-brand-ink-soft">
              If you have a question about your information, ask us in store. See{" "}
              <Link href={sitePath(shell.base, SITE_ROUTES.visit)} className={link}>
                Visit us
              </Link>{" "}
              for where to find us.
            </p>
          )}
        </section>
      </article>
    </Container>
  );
}
