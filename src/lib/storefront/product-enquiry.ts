// ZP-490: product page enquiry helpers. Pure; safe on the client and server.
//
// The WhatsApp link is built ONLY by buildWhatsAppLink (site settings
// template, src/lib/site-settings/whatsapp.ts). This module adds the product
// page's inputs (name, absolute URL, chosen colour/size) and the chip rules.
import { buildWhatsAppLink, type WhatsAppContactSettings } from '@/lib/site-settings/whatsapp'
import type { Availability } from '@/lib/storefront-model/rules'

export type ProductEnquiryInput = {
  name: string
  /** Absolute public product URL (never a preview URL), or null when unknown. */
  url: string | null
  colour?: string | null
  size?: string | null
  /** ZP-504: the public ref (PublicProduct.ref, "V-0099"); the message ends with "(ref V-0099)". */
  ref?: string | null
}

/** wa.me link for this product, or null when no WhatsApp number is set (hide the button). */
export function productEnquiryHref(
  settings: { contacts: WhatsAppContactSettings },
  input: ProductEnquiryInput,
): string | null {
  return buildWhatsAppLink(settings, {
    product: input.name,
    url: input.url,
    colour: input.colour ?? null,
    size: input.size ?? null,
    ref: input.ref ?? null,
  })
}

export const ENQUIRE_LABEL = 'Enquire on WhatsApp'
export const RESTOCK_LABEL = 'Ask about restock'

/** Button text: sold-out pieces ask about a restock. */
export function enquiryLabel(availability: Availability): string {
  return availability === 'SOLD_OUT' ? RESTOCK_LABEL : ENQUIRE_LABEL
}

/**
 * "tel:+263771234567" from a display phone number, or null when there is no
 * usable number. Formatting is stripped; a leading "+" (or the international
 * "00" prefix, ZP-510) gives the E.164 form "+<digits>".
 */
export function telHref(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim()
  let digits = raw.replace(/\D/g, '')
  const international = raw.startsWith('+') || (digits.startsWith('00') && !raw.startsWith('+'))
  if (!raw.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length < 6 || digits.length > 15) return null
  return `tel:${international ? '+' : ''}${digits}`
}

/**
 * Free-text colours/sizes ("Black, Lime; Olive") -> chip values. Splits on
 * commas, semicolons, pipes and new lines (not "/", so "S/M" stays one size),
 * trims, and drops empty and case-only duplicate entries (first spelling wins).
 */
export function splitOptions(text: string | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of (text ?? '').split(/[,;|\n\r]+/)) {
    const value = part.trim()
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/** Single select with "click again to clear". */
export function toggleOption(current: string | null, value: string): string | null {
  return current === value ? null : value
}
