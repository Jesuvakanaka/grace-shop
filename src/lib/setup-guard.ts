type Env = Partial<Record<'NODE_ENV' | 'ALLOW_SETUP', string | undefined>>;

/**
 * First-time setup (POST /api/auth/setup) lets anyone create an OWNER while the
 * user table is empty. In production that is a takeover window on a freshly
 * deployed, not-yet-seeded service, so it is disabled unless ALLOW_SETUP=true.
 */
export function isSetupAllowed(env: Env = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return env.ALLOW_SETUP === 'true';
}
