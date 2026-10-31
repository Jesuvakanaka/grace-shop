import Link from "next/link";
import type { ReactNode } from "react";
import { Mark, Wordmark } from "./Brand";
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from "./icons";
import type { NavLink } from "./types";

export type FooterColumn = { title: string; links: NavLink[] };
export type SocialLink = { label: string; href: string; icon: "instagram" | "facebook" | "whatsapp" };

type FooterProps = {
  tagline?: string;
  /** Address lines. Placeholders until the owner confirms them. */
  address?: string[];
  /** Opening hours lines. */
  hours?: string[];
  columns?: FooterColumn[];
  social?: SocialLink[];
  homeHref?: string;
  year?: number;
};

const socialIcons: Record<SocialLink["icon"], ReactNode> = {
  instagram: <InstagramIcon />,
  facebook: <FacebookIcon />,
  whatsapp: <WhatsAppIcon />,
};

const linkClass =
  "sf-focus inline-flex min-h-11 items-center rounded-[2px] text-brand-cream transition-colors duration-200 hover:text-brand-lime";

/** Ink footer with cream text and the cream wordmark. */
export function Footer({
  tagline = "Premium fashion. Modern you.",
  address = ["Shop address to follow", "City"],
  hours = ["Mon–Sat 9:00–18:00", "Sun closed"],
  columns = [],
  social = [],
  homeHref = "/",
  year,
}: FooterProps) {
  return (
    <footer className="bg-brand-ink text-brand-cream">
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-24">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr] lg:gap-16">
          <div className="flex flex-col gap-6">
            <Link href={homeHref} className="sf-focus inline-flex w-fit items-center gap-4 rounded-[2px] py-1">
              <Mark tone="mono" className="h-16 w-16 text-brand-cream" />
              <Wordmark tagline className="h-auto w-[200px] text-brand-cream" title="VYRA – Wear Different, home" />
            </Link>
            <p className="font-serif text-2xl font-medium leading-[1.2] text-brand-cream">{tagline}</p>
            {social.length > 0 ? (
              <ul className="flex gap-1">
                {social.map((s) => (
                  <li key={s.label}>
                    <a
                      href={s.href}
                      aria-label={s.label}
                      className="sf-focus inline-flex h-11 w-11 items-center justify-center rounded-[2px] text-brand-cream ring-1 ring-inset ring-brand-cream/20 transition-colors duration-200 hover:text-brand-lime hover:ring-brand-lime"
                    >
                      {socialIcons[s.icon]}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
              <h2 className="sf-label font-sans font-medium text-brand-cream-300">Visit</h2>
              <address className="text-sm not-italic leading-relaxed text-brand-cream">
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            </div>
            <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
              <h2 className="sf-label font-sans font-medium text-brand-cream-300">Hours</h2>
              <p className="text-sm leading-relaxed text-brand-cream">
                {hours.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </p>
            </div>
            {columns.map((col) => (
              <nav key={col.title} aria-label={col.title} className="flex flex-col gap-1">
                <h2 className="sf-label mb-2 font-sans font-medium text-brand-cream-300">{col.title}</h2>
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

        <div className="mt-14 flex flex-col gap-2 border-t border-brand-cream/15! pt-6 text-xs text-brand-cream-300 sm:flex-row sm:justify-between">
          <p>© {year ? `${year} ` : ""}VYRA</p>
          <p>Wear different.</p>
        </div>
      </div>
    </footer>
  );
}
