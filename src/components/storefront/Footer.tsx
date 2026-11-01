import Link from "next/link";
import { Mark, Wordmark } from "./Brand";
import { WhatsAppIcon } from "./icons";
import { SocialIcons } from "./SocialIcons";
import type { FooterColumn, SocialLink } from "./types";

export type { FooterColumn, SocialLink } from "./types";

type FooterProps = {
  /** The one VYRA tagline. */
  tagline?: string;
  /** Address lines from site settings; the block is hidden when empty. */
  address?: string[];
  /** Opening hours lines from site settings; hidden when empty. */
  hours?: string[];
  holidayNote?: string | null;
  phone?: string | null;
  email?: string | null;
  /** wa.me general enquiry link; hidden when null. */
  whatsappHref?: string | null;
  columns?: FooterColumn[];
  social?: SocialLink[];
  homeHref?: string;
  year?: number;
};

const linkClass =
  "sf-focus inline-flex min-h-11 items-center rounded-[2px] text-brand-cream transition-colors duration-200 hover:text-brand-lime";

const heading = "sf-label font-sans font-medium text-brand-cream-300";

/** Ink footer with cream text, the cream wordmark and WEAR DIFFERENT. Shows only what is set. */
export function Footer({
  tagline = "WEAR DIFFERENT.",
  address = [],
  hours = [],
  holidayNote,
  phone,
  email,
  whatsappHref,
  columns = [],
  social = [],
  homeHref = "/",
  year,
}: FooterProps) {
  const hasContact = Boolean(phone || email || whatsappHref);
  return (
    <footer className="bg-brand-ink text-brand-cream">
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-24">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr] lg:gap-16">
          <div className="flex flex-col gap-6">
            <Link
              href={homeHref}
              aria-label="VYRA home"
              className="sf-focus inline-flex w-fit items-center gap-4 rounded-[2px] py-1"
            >
              <Mark tone="mono" className="h-14 w-14 text-brand-cream" />
              <Wordmark className="h-auto w-[200px] text-brand-cream" title="" />
            </Link>
            <p className="font-sans text-sm font-medium uppercase tracking-[0.42em] text-brand-cream">{tagline}</p>
            {social.length > 0 ? <SocialIcons social={social} tone="dark" /> : null}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {address.length > 0 ? (
              <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
                <h2 className={heading}>Visit</h2>
                <address className="text-sm not-italic leading-relaxed text-brand-cream">
                  {address.map((line, i) => (
                    <span key={`${i}-${line}`} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              </div>
            ) : null}
            {hours.length > 0 ? (
              <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
                <h2 className={heading}>Hours</h2>
                <p className="text-sm leading-relaxed text-brand-cream">
                  {hours.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                  {holidayNote ? <span className="mt-2 block text-brand-cream-300">{holidayNote}</span> : null}
                </p>
              </div>
            ) : null}
            {hasContact ? (
              <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <h2 className={`${heading} mb-2`}>Contact</h2>
                <ul className="text-sm">
                  {whatsappHref ? (
                    <li>
                      <a href={whatsappHref} className={`${linkClass} gap-2`}>
                        <WhatsAppIcon className="h-4 w-4" />
                        WhatsApp us
                      </a>
                    </li>
                  ) : null}
                  {phone ? (
                    <li>
                      <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={linkClass}>
                        {phone}
                      </a>
                    </li>
                  ) : null}
                  {email ? (
                    <li>
                      <a href={`mailto:${email}`} className={`${linkClass} break-all`}>
                        {email}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            {columns.map((col) => (
              <nav key={col.title} aria-label={col.title} className="flex flex-col gap-1">
                <h2 className={`${heading} mb-2`}>{col.title}</h2>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link href={l.href} className={`${linkClass} text-sm`}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-14 border-t border-brand-cream/15! pt-6 text-xs text-brand-cream-300">
          <p>© {year ? `${year} ` : ""}VYRA</p>
        </div>
      </div>
    </footer>
  );
}
