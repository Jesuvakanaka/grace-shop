// ZP-503: the product page's WhatsApp link. Pure; safe on the client and
// server. Available pieces use the owner's enquiry template
// (productEnquiryHref); sold-out pieces ask about a restock with the same
// message as the feed (RESTOCK_TEMPLATE). The chosen colour/size and the
// public ref (ZP-504, "V-0099") are passed on; buildWhatsAppLink places them.
// Tested in tests/storefront-menu-product.test.ts.
import { buildWhatsAppLink, type WhatsAppContactSettings } from '@/lib/site-settings/whatsapp'
import type { Availability } from '@/lib/storefront-model/rules'
import { RESTOCK_TEMPLATE } from './feed'
import { productEnquiryHref, type ProductEnquiryInput } from './product-enquiry'

/** ProductEnquiryInput plus the public ref (an optional field until ZP-504 adds it there). */
export type ProductPageEnquiryInput = ProductEnquiryInput & { ref?: string | null }

export function productPageEnquiryHref(
  contacts: WhatsAppContactSettings,
  availability: Availability,
  input: ProductPageEnquiryInput,
): string | null {
  if (availability !== 'SOLD_OUT') return productEnquiryHref({ contacts }, input)
  // Same as the feed: the restock template through the one link builder.
  const enquiry = { product: input.name, url: input.url, colour: input.colour ?? null, size: input.size ?? null, ref: input.ref ?? null }
  return buildWhatsAppLink({ contacts: { ...contacts, enquiryTemplate: RESTOCK_TEMPLATE } }, enquiry)
}
