/**
 * Installing the site as an app:
 * - The manifest opens the storefront, keeps sign-in in the app and stays the same app for earlier installs.
 * - The menu's install row: the browser's prompt, the steps on iPhone and iPad, hidden when installed.
 * - The menu's staff sign-in link on the admin host and on a storefront host.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import manifest from '../src/app/manifest';
import { installMode, isIosDevice } from '../src/lib/storefront/install-app';
import { menuLoginHref } from '../src/lib/storefront/menu-model';

describe('manifest', () => {
  test('the installed app opens the storefront', () => {
    const m = manifest();
    assert.strictEqual(m.start_url, '/site');
    assert.strictEqual(m.scope, '/');
    assert.strictEqual(m.id, '/');
    assert.strictEqual(m.display, 'standalone');
  });
});

describe('installMode', () => {
  test('nothing to offer once installed', () => {
    assert.strictEqual(installMode({ standalone: true, canPrompt: true, ios: true }), null);
  });
  test('the browser prompt when there is one', () => {
    assert.strictEqual(installMode({ standalone: false, canPrompt: true, ios: false }), 'prompt');
  });
  test('the steps on iPhone and iPad', () => {
    assert.strictEqual(installMode({ standalone: false, canPrompt: false, ios: true }), 'ios');
  });
  test('hidden when the browser offers no way', () => {
    assert.strictEqual(installMode({ standalone: false, canPrompt: false, ios: false }), null);
  });
});

describe('isIosDevice', () => {
  test('iPhone, and an iPad that reports itself as a Mac', () => {
    assert.strictEqual(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', platform: 'iPhone', maxTouchPoints: 5 }), true);
    assert.strictEqual(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  });
  test('not a Mac without touch, not Android', () => {
    assert.strictEqual(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.strictEqual(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
  });
});

describe('menuLoginHref', () => {
  test('the admin host signs in at its own root', () => {
    assert.strictEqual(menuLoginHref('/site', null), '/');
  });
  test('a storefront host links to the admin host, hidden when none is set', () => {
    assert.strictEqual(menuLoginHref('', 'admin.example.com'), 'https://admin.example.com/');
    assert.strictEqual(menuLoginHref('', null), null);
    assert.strictEqual(menuLoginHref('', undefined), null);
  });
});
