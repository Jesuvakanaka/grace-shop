/**
 * Guard for destructive database operations (reset / drop / db push).
 *
 * Destructive commands may only run against a database on this machine
 * (localhost, 127.0.0.1 or ::1) and never with NODE_ENV=production or inside
 * Cloud Run. The check works on the connection URLs alone, so it refuses
 * BEFORE anything connects to the database.
 *
 * Library:  const { assertDestructiveDbAllowed } = require('./lib/db-safety');
 * CLI:      node scripts/lib/db-safety.js "<operation name>"   (exit 1 = refused)
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const URL_VARS = ['DATABASE_URL', 'DIRECT_URL'];
const CLOUD_RUN_MARKERS = ['K_SERVICE', 'CLOUD_RUN_JOB'];

/**
 * @param {string} name
 * @param {string} value
 * @returns {string | null} reason to refuse, or null when the URL is local
 */
function checkUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a valid URL.`;
  }
  const host = url.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    return `${name} points at host "${host || '(none)'}", which is not localhost/127.0.0.1/::1.`;
  }
  // `?host=/cloudsql/...` (or any socket path) overrides the hostname in the URL.
  if (url.searchParams.has('host')) {
    return `${name} sets a host= parameter (${url.searchParams.get('host')}), so the real target is not the URL host.`;
  }
  return null;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkDestructiveDbAllowed(env = process.env) {
  if (env.NODE_ENV === 'production') {
    return { allowed: false, reason: 'NODE_ENV=production.' };
  }
  const marker = CLOUD_RUN_MARKERS.find((key) => env[key]);
  if (marker) {
    return { allowed: false, reason: `running inside Cloud Run (${marker} is set).` };
  }
  if (!env.DATABASE_URL) {
    return { allowed: false, reason: 'DATABASE_URL is not set.' };
  }
  for (const name of URL_VARS) {
    if (!env[name]) continue;
    const reason = checkUrl(name, env[name]);
    if (reason) return { allowed: false, reason };
  }
  return { allowed: true, reason: 'local database outside production.' };
}

/**
 * @param {string} operation human-readable name used in the error message
 * @param {Record<string, string | undefined>} [env]
 */
function assertDestructiveDbAllowed(operation, env = process.env) {
  const { allowed, reason } = checkDestructiveDbAllowed(env);
  if (!allowed) {
    throw new Error(
      `Refusing to run ${operation}: ${reason} ` +
        'Destructive database commands only run against a local database (localhost) outside production. ' +
        'Use `npm run migrate` (prisma migrate deploy) for shared databases.',
    );
  }
}

/**
 * Prisma reads .env itself; load it here too so the guard sees the same URLs.
 * Real environment variables win over .env, matching Prisma's behaviour.
 */
function loadDotEnv() {
  if (process.env.DB_SAFETY_SKIP_DOTENV) return;
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env file – rely on the real environment
  }
}

module.exports = { checkDestructiveDbAllowed, assertDestructiveDbAllowed, loadDotEnv };

if (require.main === module) {
  loadDotEnv();
  const operation = process.argv[2] || 'a destructive database command';
  try {
    assertDestructiveDbAllowed(operation);
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}
