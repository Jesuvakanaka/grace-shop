import type { ReactNode } from "react";
import { Button, buttonClasses } from "../Button";
import { cn } from "../cn";
import { ArrowRightIcon, WhatsAppIcon } from "../icons";
import { Container } from "../Section";
import { SocialIcons } from "../SocialIcons";
import { ImageFrame, StorefrontImg } from "../StorefrontImage";
import type { DayRow, VisitModel } from "./info-model";
import { MapEmbed } from "./MapEmbed";

// ZP-491: the Visit us page. Every block hides when its value is missing.
// No map iframe on first load: "Open in Google Maps" plus a click-to-load map.

const textLink =
  "sf-focus inline-flex min-h-11 items-center gap-2 rounded-[2px] text-brand-olive-700 underline-offset-[6px] hover:underline";

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="sf-label text-brand-olive-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

function WeekHours({ rows }: { rows: DayRow[] }) {
  return (
    <table className="w-full max-w-[22rem] border-collapse font-sans text-[0.9375rem]">
      <caption className="sr-only">Opening hours this week</caption>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.day}
            aria-current={r.isToday ? "date" : undefined}
            className={cn(
              "border-b border-brand-ink/10!",
              r.isToday ? "bg-brand-olive-50 font-medium text-brand-ink" : "text-brand-ink-soft",
            )}
          >
            <th scope="row" className={cn("py-2.5 text-left font-[inherit]", r.isToday ? "pl-3" : "pl-0")}>
              <span className="inline-flex items-center gap-2">
                {r.label}
                {r.isToday ? (
                  <span className="sf-label rounded-[2px] bg-brand-lime px-1.5 py-0.5 text-[0.625rem] text-brand-ink">
                    Today
                  </span>
                ) : null}
              </span>
            </th>
            <td className={cn("py-2.5 text-right tabular-nums", r.isToday ? "pr-3" : "pr-0")}>{r.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VisitView({ model, shopHref }: { model: VisitModel; shopHref: string }) {
  const { address, hours, holidayNote, phone, email, whatsappHref, map, social } = model;
  const hasActions = Boolean(whatsappHref || phone || map);
  const intro = address.length
    ? "Come and see the collection in person. Try it on, take your time, and ask us anything."
    : whatsappHref || phone || email
      ? "Questions about a piece? We are happy to help."
      : null;

  return (
    <section aria-labelledby="visit-title" className="bg-brand-cream text-brand-ink">
      <Container className="py-12 sm:py-16 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-20">
          <div className="flex flex-col gap-10">
            <header className="flex flex-col gap-6">
              <span className="sf-rule" aria-hidden="true" />
              <h1 id="visit-title" className="sf-display text-balance">
                Visit us
              </h1>
              {intro ? <p className="sf-body text-lg text-brand-ink-soft">{intro}</p> : null}
              {hasActions ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  {whatsappHref ? (
                    <a href={whatsappHref} className={buttonClasses("primary")}>
                      <WhatsAppIcon className="h-5 w-5 shrink-0" />
                      <span>WhatsApp us</span>
                    </a>
                  ) : null}
                  {phone ? (
                    <a href={phone.href} className={buttonClasses("ghost")}>
                      Call us
                    </a>
                  ) : null}
                  {map ? (
                    <a href={map.directionsHref} rel="noopener noreferrer" className={buttonClasses("ghost")}>
                      Get directions
                    </a>
                  ) : null}
                </div>
              ) : null}
            </header>

            {model.hasDetails ? (
              <div className="grid gap-10 border-t border-brand-ink/10! pt-10 sm:grid-cols-2">
                {address.length || map ? (
                  <Block id="visit-address" title="Address">
                    {address.length ? (
                      <address className="sf-body not-italic text-brand-ink">
                        {address.map((line, i) => (
                          <span key={i} className="block">
                            {line}
                          </span>
                        ))}
                      </address>
                    ) : null}
                    {map ? (
                      <>
                        <a href={map.openHref} rel="noopener noreferrer" className={cn(textLink, "sf-label-lg")}>
                          <span>Open in Google Maps</span>
                          <ArrowRightIcon className="h-4 w-4 shrink-0" />
                        </a>
                        {map.embedSrc ? <MapEmbed src={map.embedSrc} label="Map showing the VYRA store" /> : null}
                      </>
                    ) : null}
                  </Block>
                ) : null}

                {hours || holidayNote ? (
                  <Block id="visit-hours" title="Opening hours">
                    {hours ? <WeekHours rows={hours} /> : null}
                    {holidayNote ? (
                      <p className="sf-body whitespace-pre-line text-sm text-brand-ink-soft">{holidayNote}</p>
                    ) : null}
                  </Block>
                ) : null}

                {phone || email ? (
                  <Block id="visit-contact" title="Contact">
                    <ul className="sf-body flex flex-col text-brand-ink">
                      {phone ? (
                        <li>
                          <span className="sr-only">Phone: </span>
                          <a href={phone.href} className={textLink}>
                            {phone.display}
                          </a>
                        </li>
                      ) : null}
                      {email ? (
                        <li>
                          <span className="sr-only">Email: </span>
                          <a href={email.href} className={cn(textLink, "break-all")}>
                            {email.display}
                          </a>
                        </li>
                      ) : null}
                    </ul>
                  </Block>
                ) : null}

                {social.length ? (
                  <Block id="visit-social" title="Follow VYRA">
                    <SocialIcons social={social} tone="light" />
                  </Block>
                ) : null}
              </div>
            ) : (
              <div className="border-t border-brand-ink/10! pt-10">
                <Button href={shopHref} variant="primary" arrow>
                  Explore the collection
                </Button>
              </div>
            )}
          </div>

          <ImageFrame ratio="2 / 3" className="w-full max-w-md self-start lg:max-w-none">
            <StorefrontImg image={model.image} sizes="(min-width: 1024px) 384px, (min-width: 448px) 448px, 100vw" />
          </ImageFrame>
        </div>
      </Container>
    </section>
  );
}
