import { Mark } from "../Brand";
import { WhatsAppIcon } from "../icons";

export const LISTING_EMPTY_MESSAGE = "New pieces are on their way. Ask us on WhatsApp what's arriving.";

/** Empty listing (ZP-489): the WhatsApp button shows only when a number is set. */
export function ListingEmpty({ whatsappHref }: { whatsappHref: string | null }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-4 py-16 text-center sm:py-24">
      <Mark className="h-14 w-14" />
      <span className="sf-rule" aria-hidden="true" />
      <h2 className="sf-title text-balance text-brand-ink">{LISTING_EMPTY_MESSAGE}</h2>
      {whatsappHref ? (
        <a
          href={whatsappHref}
          className="sf-focus sf-label-lg mt-2 inline-flex min-h-[52px] items-center justify-center gap-3 rounded-[2px] bg-brand-olive px-7 py-4 text-white transition-colors duration-200 hover:bg-brand-olive-700"
        >
          <WhatsAppIcon className="h-5 w-5 shrink-0" />
          <span>Ask on WhatsApp</span>
        </a>
      ) : null}
    </div>
  );
}
