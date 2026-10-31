/**
 * scripts/set-user.js: pure logic (argument parsing and the change plan).
 * The DB-backed run is in tests/business-rules.test.ts (section 9).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseArgs, planUserChange } from '../scripts/set-user.js';

describe('set-user parseArgs', () => {
  test('parses --from, --to and --full-name', () => {
    assert.deepStrictEqual(parseArgs(['--from', 'owner', '--to', 'margie', '--full-name', 'Margaret']), {
      from: 'owner',
      to: 'margie',
      fullName: 'Margaret',
    });
  });

  test('accepts --key=value and makes --full-name optional', () => {
    assert.deepStrictEqual(parseArgs(['--from=owner', '--to=margie']), { from: 'owner', to: 'margie', fullName: undefined });
  });

  test('trims values', () => {
    assert.deepStrictEqual(parseArgs(['--from', ' owner ', '--to', ' margie', '--full-name', ' Margaret ']), {
      from: 'owner',
      to: 'margie',
      fullName: 'Margaret',
    });
  });

  test('requires --from and --to', () => {
    assert.throws(() => parseArgs(['--to', 'margie']), /--from/);
    assert.throws(() => parseArgs(['--from', 'owner']), /--to/);
    assert.throws(() => parseArgs(['--from', 'owner', '--to']), /--to/);
    assert.throws(() => parseArgs(['--from', '', '--to', 'margie']), /--from/);
  });

  test('rejects an empty --full-name and unknown options (e.g. a password flag)', () => {
    assert.throws(() => parseArgs(['--from', 'owner', '--to', 'margie', '--full-name', '  ']), /--full-name/);
    assert.throws(() => parseArgs(['--from', 'owner', '--to', 'margie', '--password', 'x']), /Unknown option/);
  });
});

describe('set-user planUserChange', () => {
  const owner = { id: 1, username: 'owner', fullName: 'Business Owner' };
  const margie = { id: 1, username: 'margie', fullName: 'Margaret' };

  test('renames --from to --to and sets the full name', () => {
    assert.deepStrictEqual(planUserChange({ from: 'owner', to: 'margie', fullName: 'Margaret' }, { fromUser: owner, toUser: null }), {
      action: 'rename',
      id: 1,
      data: { username: 'margie', fullName: 'Margaret' },
      exitCode: 0,
      message: "Renamed user 'owner' to 'margie' and set full name to 'Margaret'.",
    });
  });

  test('renames without touching the full name when none is given', () => {
    const plan = planUserChange({ from: 'owner', to: 'margie' }, { fromUser: owner, toUser: null });
    assert.strictEqual(plan.action, 'rename');
    assert.deepStrictEqual(plan.data, { username: 'margie' });
    assert.strictEqual(plan.exitCode, 0);
  });

  test('idempotent: --to already exists -> only update the full name', () => {
    const plan = planUserChange(
      { from: 'owner', to: 'margie', fullName: 'Margaret M' },
      { fromUser: null, toUser: margie }
    );
    assert.deepStrictEqual(plan, {
      action: 'update',
      id: 1,
      data: { fullName: 'Margaret M' },
      exitCode: 0,
      message: "User 'margie' already exists; set full name to 'Margaret M'.",
    });
  });

  test('idempotent: --to exists with the same full name (or none given) -> nothing to do, exit 0', () => {
    for (const fullName of ['Margaret', undefined]) {
      const plan = planUserChange({ from: 'owner', to: 'margie', fullName }, { fromUser: null, toUser: margie });
      assert.strictEqual(plan.action, 'noop');
      assert.strictEqual(plan.exitCode, 0);
      assert.match(plan.message, /already exists/);
    }
  });

  test('--to exists and --from also exists: never renames onto a taken username', () => {
    const plan = planUserChange({ from: 'owner', to: 'margie' }, { fromUser: owner, toUser: { ...margie, id: 2 } });
    assert.strictEqual(plan.action, 'noop');
    assert.strictEqual(plan.exitCode, 0);
  });

  test('neither exists -> error, exit 1', () => {
    const plan = planUserChange({ from: 'owner', to: 'margie' }, { fromUser: null, toUser: null });
    assert.strictEqual(plan.action, 'error');
    assert.strictEqual(plan.exitCode, 1);
    assert.match(plan.message, /Neither 'owner' nor 'margie' exists/);
  });

  test('plans never contain a password field', () => {
    const plans = [
      planUserChange({ from: 'owner', to: 'margie', fullName: 'Margaret' }, { fromUser: owner, toUser: null }),
      planUserChange({ from: 'owner', to: 'margie', fullName: 'X' }, { fromUser: null, toUser: margie }),
    ];
    for (const p of plans) assert.strictEqual('password' in (p.data ?? {}), false);
  });
});
