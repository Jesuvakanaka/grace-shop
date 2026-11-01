// ZP-504 (owner decision 2026-11-01): the short public reference a customer's
// WhatsApp enquiry carries, so the owner can tell which piece is meant.
// "V-" + the product id zero-padded to 4 digits ("V-0099"). Derived from the
// id on purpose: it is NEVER the private item number. Pure; client and server.

export function publicProductRef(id: number): string {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid product id for a public ref: ${id}`)
  return `V-${String(id).padStart(4, '0')}`
}
