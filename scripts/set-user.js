#!/usr/bin/env node
/**
 * Rename a user and/or set their full name. Never touches passwords and never
 * prints secrets.
 *
 * Usage:
 *   node scripts/set-user.js --from owner --to margie --full-name "Margaret"
 *   npm run user:set -- --from owner --to margie --full-name "Margaret"
 *
 * Idempotent:
 *   - `--to` already exists  -> only its full name changes (if --full-name is given); exit 0.
 *   - `--from` exists        -> renamed to `--to` (id, role, password and active flag kept).
 *   - neither exists         -> exit 1 with a message.
 *
 * Uses DATABASE_URL like the rest of the app (UAT: run it as a Cloud Run job).
 */

const KNOWN_OPTIONS = { '--from': 'from', '--to': 'to', '--full-name': 'fullName' };

/**
 * @typedef {{ from: string, to: string, fullName?: string }} SetUserOptions
 * @typedef {{ id: number, username: string, fullName: string } | null} UserRow
 * @typedef {{ action: 'rename' | 'update' | 'noop' | 'error', id?: number, data?: { username?: string, fullName?: string }, exitCode: number, message: string }} SetUserPlan
 */

/**
 * Parse CLI arguments. Throws an Error with a usage hint on bad input.
 * @param {string[]} argv
 * @returns {SetUserOptions}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const key = KNOWN_OPTIONS[name];
    if (!key) {
      throw new Error(`Unknown option '${name}'. Usage: set-user --from <username> --to <username> [--full-name "<name>"]`);
    }
    let value;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) value = undefined;
      else i++;
    }
    out[key] = value === undefined ? undefined : value.trim();
  }

  for (const [flag, key] of [['--from', 'from'], ['--to', 'to']]) {
    if (!out[key]) throw new Error(`${flag} <username> is required`);
  }
  if (out.fullName !== undefined && out.fullName === '') {
    throw new Error('--full-name must not be empty');
  }
  return { from: out.from, to: out.to, fullName: out.fullName };
}

/**
 * Decide what to do, given the current `fromUser` / `toUser` rows (or null).
 * Returns { action: 'rename' | 'update' | 'noop' | 'error', id?, data?, exitCode, message }.
 * `data` only ever contains `username` and/or `fullName`.
 * @param {SetUserOptions} opts
 * @param {{ fromUser: UserRow, toUser: UserRow }} rows
 * @returns {SetUserPlan}
 */
function planUserChange({ from, to, fullName }, { fromUser, toUser }) {
  if (toUser) {
    if (fullName !== undefined && fullName !== toUser.fullName) {
      return {
        action: 'update',
        id: toUser.id,
        data: { fullName },
        exitCode: 0,
        message: `User '${to}' already exists; set full name to '${fullName}'.`,
      };
    }
    return { action: 'noop', exitCode: 0, message: `User '${to}' already exists; nothing to change.` };
  }

  if (fromUser) {
    const data = { username: to };
    if (fullName !== undefined) data.fullName = fullName;
    return {
      action: 'rename',
      id: fromUser.id,
      data,
      exitCode: 0,
      message:
        `Renamed user '${from}' to '${to}'` + (fullName !== undefined ? ` and set full name to '${fullName}'.` : '.'),
    };
  }

  return {
    action: 'error',
    exitCode: 1,
    message: `Neither '${from}' nor '${to}' exists. Nothing changed. Check the usernames (and DATABASE_URL).`,
  };
}

/**
 * Look up both users, apply the plan, and return it. Only username/fullName are ever written.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {SetUserOptions} opts
 * @returns {Promise<SetUserPlan>}
 */
async function setUser(prisma, opts) {
  const select = { id: true, username: true, fullName: true };
  const [fromUser, toUser] = await Promise.all([
    prisma.user.findUnique({ where: { username: opts.from }, select }),
    prisma.user.findUnique({ where: { username: opts.to }, select }),
  ]);
  const plan = planUserChange(opts, { fromUser, toUser });
  if (plan.action === 'rename' || plan.action === 'update') {
    await prisma.user.update({ where: { id: plan.id }, data: plan.data, select: { id: true } });
  }
  return plan;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`set-user: ${error.message}`);
    process.exit(1);
  }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const plan = await setUser(prisma, opts);
    (plan.exitCode === 0 ? console.log : console.error)(`set-user: ${plan.message}`);
    process.exitCode = plan.exitCode;
  } catch (error) {
    // Prisma errors can include the connection string; print only the error code/name.
    console.error(`set-user: failed (${error && (error.code || error.name) ? error.code || error.name : 'unknown error'})`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, planUserChange, setUser };
