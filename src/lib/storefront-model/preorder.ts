// Pre-order label for the public site. Pure; no database, no UI.
// Dates are ISO strings (or Dates); months are read in UTC.

export type PreOrderInfo = { shipFrom: string | null; shipTo: string | null; label: string }

export const PREORDER_LABEL = 'Pre-order'
export const PREORDER_ENQUIRE_LABEL = 'Pre-order on WhatsApp'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(value: Date | string | null | undefined): { y: number; m: number } | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
}

/** "Feb–Mar 2027", "Mar 2027", "Dec 2026–Jan 2027", or "" with no usable date. */
export function shipWindow(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  const a = parts(from)
  const b = parts(to)
  if (!a && !b) return ''
  if (!a || !b) {
    const p = (a ?? b)!
    return `${MONTHS[p.m]} ${p.y}`
  }
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.y}`
  if (a.y === b.y) return `${MONTHS[a.m]}–${MONTHS[b.m]} ${a.y}`
  return `${MONTHS[a.m]} ${a.y}–${MONTHS[b.m]} ${b.y}`
}

/** "Pre-order · ships Feb–Mar 2027", "Pre-order · ships Mar 2027", or "Pre-order". */
export function preOrderLabel(from: Date | string | null | undefined, to: Date | string | null | undefined): string {
  const w = shipWindow(from, to)
  return w ? `${PREORDER_LABEL} · ships ${w}` : PREORDER_LABEL
}

function iso(value: Date | string | null | undefined): string | null {
  const p = parts(value)
  if (!p) return null
  return new Date(Date.UTC(p.y, p.m, 1)).toISOString()
}

export function toPreOrderInfo(
  row: { listingType?: string | null; preorderShipFrom?: Date | string | null; preorderShipTo?: Date | string | null },
): PreOrderInfo | null {
  if (row.listingType !== 'PRE_ORDER') return null
  return {
    shipFrom: iso(row.preorderShipFrom),
    shipTo: iso(row.preorderShipTo),
    label: preOrderLabel(row.preorderShipFrom, row.preorderShipTo),
  }
}

/** The WhatsApp template for a pre-order: names the pre-order and the ship window. */
export function preOrderTemplate(info: Pick<PreOrderInfo, 'shipFrom' | 'shipTo'>): string {
  const w = shipWindow(info.shipFrom, info.shipTo)
  return w
    ? `Hi VYRA, I would like to pre-order the {product} (ships ${w}). ({url})`
    : 'Hi VYRA, I would like to pre-order the {product}. ({url})'
}
