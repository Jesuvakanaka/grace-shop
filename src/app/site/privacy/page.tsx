import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/storefront";
import { SITE_ROUTES, sitePath } from "@/lib/storefront/paths";
import { getShellData } from "@/lib/storefront/shell";

// ZP-487: short, plain-language privacy notice. Contact details come from the
// site settings and only show when set.
// ZP-493: rewritten for first-party analytics. It must describe exactly what
// src/lib/analytics/** collects (event catalogue in src/lib/analytics/events.ts,
// docs/storefront/analytics.md) and how long it is kept (rollup.ts). Change
// this page whenever that changes.
export const metadata: Metadata = {
  title: "Privacy",
  description: "How the VYRA website handles your information.",
};

const link = "sf-focus rounded-[2px] text-brand-olive-700 underline underline-offset-4 hover:text-brand-ink";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-brand-ink/10! pt-8">
      <h2 id={id} className="sf-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

const list = "sf-body flex list-disc flex-col gap-2 pl-5 text-brand-ink-soft marker:text-brand-olive-700";

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
            The short version: browsing this website does not ask for your name, phone number, email or payment details. To
            learn which pieces people like, it counts visits anonymously, on our own systems. Nothing is sold or
            shared, there are no cookies and no advertising trackers.
          </p>
        </header>

        <Section id="privacy-counted" title="What we count">
          <p className="sf-body text-brand-ink-soft">
            While you browse, the site records simple, anonymous facts about the visit:
          </p>
          <ul className={list}>
            <li>which pages, looks, photos and videos you view, and for how long they are on your screen;</li>
            <li>
              which buttons you tap, such as showing details, choosing a size or colour, enquiring on WhatsApp,
              calling, sharing or getting directions;
            </li>
            <li>
              where the visit came from: the name of the referring site only (for example instagram.com, or
              &ldquo;direct&rdquo;) and a campaign tag if the link had one, never the full address you came from;
            </li>
            <li>the type of device (phone, tablet or computer), the screen size and the language of your browser;</li>
            <li>if a page or picture fails to load or is slow, so we can fix it.</li>
          </ul>
          <p className="sf-body text-brand-ink-soft">
            We use this only to understand what our visitors like, to show the most popular pieces first, and to keep
            the site working well.
          </p>
        </Section>

        <Section id="privacy-ids" title="Visit and device IDs, no cookies">
          <p className="sf-body text-brand-ink-soft">
            To tell visits apart, your browser makes up two random codes that say nothing about you. A{" "}
            <strong className="font-medium text-brand-ink">visit ID</strong> is kept in the browser&apos;s session
            storage and ends when the tab or browser session ends (a new one also starts after 30 minutes without
            activity). A{" "}
            <strong className="font-medium text-brand-ink">device ID</strong> is kept in the browser&apos;s local
            storage so we can count returning visitors; it stays until you clear this site&apos;s data in your browser
            settings, which also resets it. The site also remembers small display choices in session storage, such as
            whether product details are shown. We do not set cookies.
          </p>
          <p className="sf-body text-brand-ink-soft">
            <strong className="font-medium text-brand-ink">Hearts:</strong> when you love a look, your browser
            remembers it in local storage, and we count one heart per device: we store only an anonymous code made from
            your device ID and the piece with a secret key (a salted hash), never the device ID itself.
          </p>
        </Section>

        <Section id="privacy-never" title="What we never collect">
          <ul className={list}>
            <li>your name, phone number, email address or any account: there are no accounts on this site;</li>
            <li>
              your IP address: our analytics use it only in the server&apos;s memory, for rate limiting (to stop floods
              of fake traffic), and never write it to the database or to logs;
            </li>
            <li>what you write to us on WhatsApp (see below), and anything you do on other websites or apps.</li>
          </ul>
          <p className="sf-body text-brand-ink-soft">
            Everything is first-party: it is stored in VYRA&apos;s own database, with no Google, Facebook or other
            third-party analytics or pixels. It is not sold or shared with anyone.
          </p>
        </Section>

        <Section id="privacy-retention" title="How long we keep it">
          <p className="sf-body text-brand-ink-soft">
            The detailed records of each visit are deleted after 90 days. Before that, they are added up into daily
            totals (for example, &ldquo;this dress was viewed 40 times on Monday&rdquo;), which contain no visit or
            device IDs and are kept for 25 months, then deleted.
          </p>
        </Section>

        <Section id="privacy-choice" title="Your choice">
          <p className="sf-body text-brand-ink-soft">
            If your browser sends a Global Privacy Control or Do Not Track signal, the site collects nothing at all
            about your visit. You can also clear this site&apos;s data in your browser at any time.
          </p>
        </Section>

        <Section id="privacy-visits" title="Technical logs">
          <p className="sf-body text-brand-ink-soft">
            Like most websites, the servers that host the site keep standard technical request logs (such as the IP
            address, browser type and the page requested) for a limited time to keep the site secure and working.
            They are not used for the visit counts above.
          </p>
        </Section>

        <Section id="privacy-whatsapp" title="Enquiries on WhatsApp">
          <p className="sf-body text-brand-ink-soft">
            When you tap an &ldquo;Enquire on WhatsApp&rdquo; button, WhatsApp opens with a message ready for you to
            send. Nothing is sent until you press send. Your conversation with us then happens on WhatsApp, under
            WhatsApp&apos;s own terms and privacy policy. We only use what you tell us to answer your enquiry. The site
            counts that the button was tapped, not what you write.
          </p>
        </Section>

        {/* ZP-508: customer reviews. */}
        <Section id="privacy-reviews" title="Reviews">
          <p className="sf-body text-brand-ink-soft">
            If you bought from us, we may send you a one-time link to review your piece or our shop. The review form is
            the only place on this site that asks for your name. A review shows your first name and the initial of your
            last name (for example &ldquo;Tendai M.&rdquo;), your star rating, your words and the date; your full name
            is not kept. Location and camera details are removed from a photo you add. The photo is only kept, and
            only shown with your review, if you tick the box allowing it; otherwise it is deleted when you send the
            review. A photo you remove or replace is deleted straight away, and a photo added to a link that is never
            used is deleted within a day after the link expires (30 days). Your phone number is never published, and
            the review page itself is not counted in our visit statistics. Every review is checked by us before it
            appears. To change or remove your review, just ask us using the details below: deleting a review also
            deletes its photo.
          </p>
        </Section>

        <Section id="privacy-contact" title="Questions">
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
        </Section>
      </article>
    </Container>
  );
}
