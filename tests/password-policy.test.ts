import { test, describe } from 'node:test';
import assert from 'node:assert';
import { validatePasswordChange, MIN_PASSWORD_LENGTH } from '../src/lib/password-policy';

describe('Password change validation (ZP-465)', () => {
  const base = { username: 'owner', currentPassword: 'old-password', newPassword: 'correct horse battery' };

  test('minimum length is 12', () => {
    assert.strictEqual(MIN_PASSWORD_LENGTH, 12);
  });

  test('accepts a valid change', () => {
    assert.deepStrictEqual(validatePasswordChange(base), { ok: true });
  });

  test('requires the current password', () => {
    const r = validatePasswordChange({ ...base, currentPassword: '' });
    assert.strictEqual(r.ok, false);
    assert.match(r.ok ? '' : r.error, /current password/i);
  });

  test('requires a new password', () => {
    const r = validatePasswordChange({ ...base, newPassword: undefined });
    assert.strictEqual(r.ok, false);
  });

  test('rejects non-string inputs', () => {
    const r = validatePasswordChange({ ...base, newPassword: 123456789012345 as unknown as string });
    assert.strictEqual(r.ok, false);
  });

  test('rejects a new password shorter than 12 characters', () => {
    const r = validatePasswordChange({ ...base, newPassword: 'elevenchars' });
    assert.strictEqual(r.ok, false);
    assert.match(r.ok ? '' : r.error, /12/);
  });

  test('accepts exactly 12 characters', () => {
    assert.deepStrictEqual(validatePasswordChange({ ...base, newPassword: 'twelve-chars' }), { ok: true });
  });

  test('rejects a new password equal to the username (case-insensitive, trimmed)', () => {
    const longName = 'shopmanager2026';
    for (const pw of [longName, longName.toUpperCase(), `  ${longName}  `]) {
      const r = validatePasswordChange({ username: longName, currentPassword: 'x', newPassword: pw });
      assert.strictEqual(r.ok, false, pw);
      assert.match(r.ok ? '' : r.error, /username/i);
    }
  });

  test('rejects a new password equal to the current password', () => {
    const r = validatePasswordChange({ ...base, currentPassword: base.newPassword });
    assert.strictEqual(r.ok, false);
  });

  test('rejects whitespace-only passwords', () => {
    const r = validatePasswordChange({ ...base, newPassword: ' '.repeat(20) });
    assert.strictEqual(r.ok, false);
  });
});
