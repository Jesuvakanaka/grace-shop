"use client";

// ZP-490: the interactive parts of the product page. One provider holds the
// chosen colour and size; the chips, the inline (desktop) enquiry button and
// the sticky (phone) bar all read it, so the WhatsApp message always names
// what the visitor picked. The link itself is built only by
// buildWhatsAppLink (via productEnquiryHref) from the site settings template.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WhatsAppContactSettings } from "@/lib/site-settings/whatsapp";
import { enquiryLabel, productEnquiryHref, toggleOption } from "@/lib/storefront/product-enquiry";
import type { Availability } from "@/lib/storefront-model/rules";
import { EnquiryButton } from "../EnquiryButton";
import { cn } from "../cn";

type EnquiryState = {
  colour: string | null;
  size: string | null;
  setColour: (value: string | null) => void;
  setSize: (value: string | null) => void;
  href: string | null;
  label: string;
};

const EnquiryContext = createContext<EnquiryState | null>(null);

function useEnquiry(): EnquiryState {
  const value = useContext(EnquiryContext);
  if (!value) throw new Error("Product enquiry components must be inside <ProductEnquiryProvider>");
  return value;
}

export function ProductEnquiryProvider({
  contacts,
  productName,
  productUrl,
  availability,
  children,
}: {
  /** Only the WhatsApp fields of the public site settings. */
  contacts: WhatsAppContactSettings;
  productName: string;
  /** Absolute public URL (never a preview URL), or null. */
  productUrl: string | null;
  availability: Availability;
  children: ReactNode;
}) {
  const [colour, setColour] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const value = useMemo<EnquiryState>(
    () => ({
      colour,
      size,
      setColour,
      setSize,
      href: productEnquiryHref({ contacts }, { name: productName, url: productUrl, colour, size }),
      label: enquiryLabel(availability),
    }),
    [colour, size, contacts, productName, productUrl, availability],
  );
  return <EnquiryContext.Provider value={value}>{children}</EnquiryContext.Provider>;
}

function OptionGroup({
  legend,
  options,
  selected,
  onSelect,
}: {
  legend: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <fieldset>
      <legend className="sf-label mb-3 text-brand-ink">
        {legend}
        {selected ? <span className="text-brand-ink-soft">: {selected}</span> : null}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option === selected;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(toggleOption(selected, option))}
              className={cn(
                "sf-focus sf-label inline-flex min-h-11 min-w-11 items-center justify-center rounded-[2px] border px-3 transition-colors duration-200",
                active
                  ? "border-brand-ink! bg-brand-ink text-brand-cream"
                  : "border-brand-ink/20! bg-white text-brand-ink hover:border-brand-ink!",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Colour and size chips (single select each; press again to clear). Hidden when there are none. */
export function ProductOptions({ colours, sizes }: { colours: string[]; sizes: string[] }) {
  const { colour, size, setColour, setSize } = useEnquiry();
  if (colours.length === 0 && sizes.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {colours.length > 0 ? <OptionGroup legend="Colour" options={colours} selected={colour} onSelect={setColour} /> : null}
      {sizes.length > 0 ? <OptionGroup legend="Size" options={sizes} selected={size} onSelect={setSize} /> : null}
    </div>
  );
}

/**
 * The olive "ENQUIRE ON WHATSAPP" button ("ASK ABOUT RESTOCK" when sold out).
 * "inline" sits in the details column from lg up; "sticky" is the phone bar
 * (render it as a direct child of the product <article>). Renders nothing
 * when no WhatsApp number is set.
 */
export function ProductEnquiryButton({ placement, className }: { placement: "inline" | "sticky"; className?: string }) {
  const { href, label } = useEnquiry();
  if (!href) return null;
  return <EnquiryButton href={href} label={label} placement={placement} className={className} />;
}
