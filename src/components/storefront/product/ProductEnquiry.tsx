"use client";

// ZP-490: the enquiry state of a piece, now used by the feed's details sheet
// (ZP-510; the product page is gone, ZP-512). One provider holds the chosen
// colour and size; the chips and the sheet's WhatsApp button read it, so the
// message always names what the visitor picked. The link itself is built only by
// buildWhatsAppLink (via productPageEnquiryHref: the site settings template,
// or the feed's restock message for sold-out pieces, ZP-503).
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WhatsAppContactSettings } from "@/lib/site-settings/whatsapp";
import { enquiryLabel } from "@/lib/storefront/product-enquiry";
import { productPageEnquiryHref } from "@/lib/storefront/product-page-enquiry";
import type { Availability } from "@/lib/storefront-model/rules";

type EnquiryState = {
  colour: string | null;
  size: string | null;
  setColour: (value: string | null) => void;
  setSize: (value: string | null) => void;
  href: string | null;
  label: string;
  /** ZP-493: the piece (analytics) and whether it is sold out (restock_request instead of whatsapp_enquire). */
  slug: string | null;
  soldOut: boolean;
};

const EnquiryContext = createContext<EnquiryState | null>(null);

export function useEnquiry(): EnquiryState {
  const value = useContext(EnquiryContext);
  if (!value) throw new Error("Product enquiry components must be inside <ProductEnquiryProvider>");
  return value;
}

export function ProductEnquiryProvider({
  contacts,
  productName,
  productUrl,
  availability,
  productRef,
  slug = null,
  defaultColour = null,
  children,
}: {
  /** Only the WhatsApp fields of the public site settings. */
  contacts: WhatsAppContactSettings;
  productName: string;
  /** Absolute public URL (never a preview URL), or null. */
  productUrl: string | null;
  availability: Availability;
  /** ZP-504: the public ref ("V-0099"), never the item number. */
  productRef?: string | null;
  /** ZP-493: the piece's slug, for the size / colour / enquiry analytics events. */
  slug?: string | null;
  /** ZP-513 review: a piece's only colour (no picker): in the message unless another is picked. */
  defaultColour?: string | null;
  children: ReactNode;
}) {
  const [colour, setColour] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const value = useMemo<EnquiryState>(
    () => ({
      colour: colour ?? defaultColour,
      size,
      setColour,
      setSize,
      // ZP-503: sold-out pieces send the restock message; ZP-504: the public ref goes along.
      href: productPageEnquiryHref(contacts, availability, { name: productName, url: productUrl, colour: colour ?? defaultColour, size, ref: productRef }),
      label: enquiryLabel(availability),
      slug,
      soldOut: availability === "SOLD_OUT",
    }),
    [colour, defaultColour, size, contacts, productName, productUrl, availability, productRef, slug],
  );
  return <EnquiryContext.Provider value={value}>{children}</EnquiryContext.Provider>;
}
