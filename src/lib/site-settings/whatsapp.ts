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
}

const PLACEHOLDER = /\{(product|url|colour|size)\}/g

/**
 * https://wa.me/<digits>?text=<encoded>, or null when no usable number is set.
 *
 * - With `product`: the enquiry template, with {product}, {url}, {colour} and
 *   {size} filled in (one pass, so text in a product name is never expanded
 *   again). An unused "()" left by a missing {url} is removed. Colour and size
 *   the template does not mention are appended on their own lines.
 * - Without `product`: the general enquiry message.
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
    }
    message = template
      .replace(PLACEHOLDER, (_, name: string) => values[name])
      .replace(/\s*\(\s*\)/g, '')
      .trim()
    const extra: string[] = []
    if (values.colour && !template.includes('{colour}')) extra.push(`Colour: ${values.colour}`)
    if (values.size && !template.includes('{size}')) extra.push(`Size: ${values.size}`)
    if (extra.length) message = [message, ...extra].join('\n')
  } else {
    message = settings.contacts.generalEnquiryMessage.trim()
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}
