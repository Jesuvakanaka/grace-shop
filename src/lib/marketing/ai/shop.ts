// VYRA Marketing hub: who the shop is, as every AI prompt says it. Pure.
export const SHOP_NAME = 'VYRA'
/** Used until the owner writes their own line in Marketing > Settings. */
export const DEFAULT_SHOP_DESCRIPTION = "a boutique for children's and family clothing"

export interface ShopIdentity {
  name: string
  description: string
}
export interface ShopPolicies {
  delivery?: string | null
  returns?: string | null
  ordering?: string | null
}

export function shopIdentity(settings?: { shopDescription?: string | null } | null): ShopIdentity {
  const d = settings?.shopDescription?.trim().replace(/\.+$/, '')
  return { name: SHOP_NAME, description: d || DEFAULT_SHOP_DESCRIPTION }
}

export function shopPolicies(settings?: { policyDelivery?: string | null; policyReturns?: string | null; policyOrdering?: string | null } | null): ShopPolicies {
  return { delivery: settings?.policyDelivery ?? null, returns: settings?.policyReturns ?? null, ordering: settings?.policyOrdering ?? null }
}
