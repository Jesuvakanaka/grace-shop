// ZP-486: WhatsApp "click to chat" links. Pure; safe on the client and server.

export type WhatsAppContactSettings = {
  whatsappNumber: string | null
  enquiryTemplate: string
  generalEnquiryMessage: string
}

export type WhatsAppEnquiry = {
  product?: string | null
  url?: string | null
  colour?: string | null
  size?: string | null
  /** ZP-504: public product ref ("V-0099", publicProductRef); never the item number. */
  ref?: string | null
}

const PLACEHOLDER = /\{(product|url|colour|size|ref)\}/g

/**
 * https://wa.me/<digits>?text=<encoded>, or null when no usable number is set.
 *
 * - With `product`: the enquiry template, with {product}, {url}, {colour},
 *   {size} and {ref} filled in (one pass, so text in a product name is never
 *   expanded again). Without a url, only the "({url})" wrapper in the template
 *   is removed (other parentheses stay) and a bare {url} becomes ""; the same
 *   for "({ref})" / "(ref {ref})" without a ref. Colour and size the template
 *   does not mention are appended on their own lines.
 * - ZP-504: a ref the template does not place with {ref} ends the message:
 *   " (ref V-0099)", or "(ref V-0099)" on its own line after appended
 *   colour/size lines.
 * - Without `product`: the general enquiry message (never a ref).
 */
export function buildWhatsAppLink(
  settings: { contacts: WhatsAppContactSettings },
  enquiry: WhatsAppEnquiry = {},
): string | null {
  const digits = (settings.contacts.whatsappNumber ?? '').replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null

  const product = enquiry.product?.trim()
  let message: string
  if (product) {
    const template = settings.contacts.enquiryTemplate
    const values: Record<string, string> = {
      product,
      url: enquiry.url?.trim() ?? '',
      colour: enquiry.colour?.trim() ?? '',
      size: enquiry.size?.trim() ?? '',
      ref: enquiry.ref?.trim() ?? '',
    }
    // Without a url (or ref), drop its "(...)" wrapper from the TEMPLATE before
    // filling it in, so parentheses in the product name or elsewhere stay.
    let parts = values.url ? template : template.replace(/[ \t]*\(\s*\{url\}\s*\)/g, '')
    if (!values.ref) parts = parts.replace(/[ \t]*\(\s*(?:ref\s+)?\{ref\}\s*\)/gi, '')
    message = parts.replace(PLACEHOLDER, (_, name: string) => values[name]).trim()
    const extra: string[] = []
    if (values.colour && !template.includes('{colour}')) extra.push(`Colour: ${values.colour}`)
    if (values.size && !template.includes('{size}')) extra.push(`Size: ${values.size}`)
    if (extra.length) message = [message, ...extra].join('\n')
    if (values.ref && !template.includes('{ref}')) {
      message = extra.length ? `${message}\n(ref ${values.ref})` : `${message} (ref ${values.ref})`
    }
  } else {
    message = settings.contacts.generalEnquiryMessage.trim()
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}
