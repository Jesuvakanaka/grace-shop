// ZP-508: CSRF guard for the public review POSTs. Pure.
//
// The review form posts from the same origin. Browsers send
// Sec-Fetch-Site; when present it must be exactly "same-origin". Otherwise
// the Origin header's host must equal the Host header. A request with
// neither is refused (every browser that can run the form sends one).
// The submit endpoint additionally requires a JSON body, which a cross-site
// form cannot send without a CORS preflight (no CORS headers are served).

export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin'
  const origin = headers.get('origin')
  const host = headers.get('host')
  if (!origin || !host || origin === 'null') return false
  try {
    return new URL(origin).host.toLowerCase() === host.trim().toLowerCase()
  } catch {
    return false
  }
}
