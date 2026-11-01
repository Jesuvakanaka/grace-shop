/**
 * ZP-487: storefront shell, pure parts.
 * - Link prefixing for the two front doors (src/lib/storefront/paths.ts).
 * - The shell model built from public settings + categories (src/lib/storefront/shell-model.ts).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SITE_ROUTES, siteBaseForHost, sitePath } from '../src/lib/storefront/paths';
import { buildShellModel, formatOpeningHours, splitAddress } from '../src/lib/storefront/shell-model';
import { toPublicSiteSettings } from '../src/lib/site-settings/dto';
import { SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema';
import type { OpeningHours } from '../src/lib/site-settings/schema';
import type { PublicCategory } from '../src/lib/storefront/dto';

describe('sitePath: storefront links on both front doors', () => {
  test('admin/UAT host: everything under /site', () => {
    assert.strictEqual(sitePath('/site', '/'), '/site');
    assert.strictEqual(sitePath('/site', ''), '/site');
    assert.strictEqual(sitePath('/site', '/shop'), '/site/shop');
    assert.strictEqual(sitePath('/site', 'shop'), '/site/shop');
    assert.strictEqual(sitePath('/site', '/collections/dresses'), '/site/collections/dresses');
    assert.strictEqual(sitePath('/site', '/?ref=nav'), '/site?ref=nav');
    assert.strictEqual(sitePath('/site', '/#top'), '/site#top');
    assert.strictEqual(sitePath('/site', '/shop?sort=newest#grid'), '/site/shop?sort=newest#grid');
  });

  test('storefront host: clean paths', () => {
    assert.strictEqual(sitePath('', '/'), '/');
    assert.strictEqual(sitePath('', ''), '/');
    assert.strictEqual(sitePath('', '/shop'), '/shop');
    assert.strictEqual(sitePath('', 'about'), '/about');
    assert.strictEqual(sitePath('', '/?ref=nav'), '/?ref=nav');
  });

  test('never double-prefixes an already internal path', () => {
    assert.strictEqual(sitePath('/site', '/site'), '/site');
    assert.strictEqual(sitePath('/site', '/site/shop'), '/site/shop');
    assert.strictEqual(sitePath('', '/site/shop'), '/shop');
    assert.strictEqual(sitePath('', '/site'), '/');
    // "/sitemap" is not under "/site".
    assert.strictEqual(sitePath('/site', '/sitemap'), '/site/sitemap');
  });

  test('external, protocol-relative, mailto/tel and hash-only links are left alone', () => {
    for (const href of ['https://wa.me/263771234567', 'http://x.test/a', '//evil.test/x', 'mailto:a@b.co', 'tel:+263', '#main']) {
      assert.strictEqual(sitePath('/site', href), href, href);
      assert.strictEqual(sitePath('', href), href, href);
    }
  });

  test('site base comes from the host routing config', () => {
    const config = { storefrontHosts: ['vyra.example'], adminHosts: ['admin.vyra.example'] };
    assert.strictEqual(siteBaseForHost('vyra.example', config), '');
    assert.strictEqual(siteBaseForHost('www.vyra.example:443', config), '');
    assert.strictEqual(siteBaseForHost('admin.vyra.example', config), '/site');
    assert.strictEqual(siteBaseForHost('grace-shop-uat-xyz.a.run.app', config), '/site');
    assert.strictEqual(siteBaseForHost(null, config), '/site');
    // No hosts configured (UAT today): /site everywhere.
    assert.strictEqual(siteBaseForHost('vyra.example', { storefrontHosts: [], adminHosts: [] }), '/site');
  });

  test('route map: the clean paths every page builder links to', () => {
    assert.strictEqual(SITE_ROUTES.home, '/');
    assert.strictEqual(SITE_ROUTES.shop, '/shop');
    assert.strictEqual(SITE_ROUTES.collections, '/collections');
    assert.strictEqual(SITE_ROUTES.newArrivals, '/new');
    assert.strictEqual(SITE_ROUTES.about, '/about');
    assert.strictEqual(SITE_ROUTES.visit, '/visit');
    assert.strictEqual(SITE_ROUTES.privacy, '/privacy');
    assert.strictEqual(SITE_ROUTES.collection('dresses'), '/collections/dresses');
    assert.strictEqual(SITE_ROUTES.product('lime dress/x'), '/p/lime%20dress%2Fx');
  });
});

const weekdays = { closed: false as const, open: '09:00', close: '17:30' };

function hours(overrides: Partial<OpeningHours> = {}): OpeningHours {
  return {
    mon: weekdays,
    tue: weekdays,
    wed: weekdays,
    thu: weekdays,
    fri: weekdays,
    sat: { closed: false, open: '09:00', close: '13:00' },
    sun: { closed: true },
    ...overrides,
  };
}

describe('opening hours and address formatting', () => {
  test('consecutive days with the same hours are grouped', () => {
    assert.deepStrictEqual(formatOpeningHours(hours()), ['Mon–Fri 09:00–17:30', 'Sat 09:00–13:00', 'Sun closed']);
  });

  test('non-consecutive equal days stay separate; every day closed', () => {
    assert.deepStrictEqual(
      formatOpeningHours(hours({ wed: { closed: true } })),
      ['Mon–Tue 09:00–17:30', 'Wed closed', 'Thu–Fri 09:00–17:30', 'Sat 09:00–13:00', 'Sun closed'],
    );
    const allClosed = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { closed: true }]),
    ) as OpeningHours;
    assert.deepStrictEqual(formatOpeningHours(allClosed), ['Mon–Sun closed']);
  });

  test('not set means nothing to show', () => {
    assert.deepStrictEqual(formatOpeningHours(null), []);
    assert.deepStrictEqual(splitAddress(null), []);
    assert.deepStrictEqual(splitAddress('   '), []);
  });

  test('address lines: split on newlines and commas-free, trimmed, blanks dropped', () => {
    assert.deepStrictEqual(splitAddress(' 12 Fife Avenue \r\n\n Harare '), ['12 Fife Avenue', 'Harare']);
  });
});

function settings(overrides: Partial<typeof SITE_SETTINGS_DEFAULTS> = {}) {
  return toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, ...overrides });
}

const categories: PublicCategory[] = [
  { slug: 'dresses', name: 'Dresses', description: null, heroImage: null },
  { slug: 'sets', name: 'Sets', description: 'Co-ords', heroImage: null },
];

describe('buildShellModel', () => {
  test('defaults (nothing configured): fallback nav to what remains (ZP-514), no WhatsApp, no socials, no address or hours', () => {
    const m = buildShellModel({ settings: settings(), categories: [], base: '/site' });
    assert.strictEqual(m.homeHref, '/site');
    assert.deepStrictEqual(
      m.nav.map((n) => [n.label, n.href]),
      [
        ['New in', '/site'],
        ['About', '/site/about'],
        ['Visit us', '/site/visit'],
        ['Privacy', '/site/privacy'],
      ],
    );
    assert.ok(!('footerColumns' in m), 'no footer any more');
    assert.strictEqual(m.whatsappHref, null);
    assert.deepStrictEqual(m.social, []);
    assert.deepStrictEqual(m.address, []);
    assert.deepStrictEqual(m.hours, []);
    assert.strictEqual(m.holidayNote, null);
    assert.strictEqual(m.phone, null);
    assert.strictEqual(m.email, null);
    assert.strictEqual(m.tagline, 'WEAR DIFFERENT.');
  });

  test('categories are feed collections (?c=<slug>) after New in', () => {
    const m = buildShellModel({ settings: settings(), categories, base: '/site' });
    assert.deepStrictEqual(m.nav.slice(0, 3).map((n) => [n.label, n.href]), [
      ['New in', '/site'],
      ['Dresses', '/site?c=dresses'],
      ['Sets', '/site?c=sets'],
    ]);
  });

  test('storefront host: clean links everywhere', () => {
    const m = buildShellModel({ settings: settings(), categories, base: '' });
    assert.strictEqual(m.homeHref, '/');
    const links = m.nav.map((n) => n.href);
    assert.ok(links.every((href) => !href.startsWith('/site')), links.join(' '));
    assert.ok(links.includes('/privacy') && links.includes('/?c=dresses'));
  });

  test('configured settings: WhatsApp general enquiry link, only the socials set, address and hours', () => {
    const m = buildShellModel({
      settings: settings({
        whatsappNumber: '+263771234567',
        generalEnquiryMessage: 'Hi VYRA, a question',
        instagramUrl: 'https://instagram.com/vyra',
        tiktokUrl: 'https://www.tiktok.com/@vyra',
        address: '12 Fife Avenue\nHarare',
        openingHours: hours(),
        holidayNote: 'Closed on public holidays',
        phone: '+263 77 123 4567',
        email: 'hello@vyra.example',
      }),
      categories,
      base: '/site',
    });
    assert.strictEqual(m.whatsappHref, 'https://wa.me/263771234567?text=Hi%20VYRA%2C%20a%20question');
    assert.deepStrictEqual(
      m.social.map((s) => [s.icon, s.href]),
      [
        ['instagram', 'https://instagram.com/vyra'],
        ['tiktok', 'https://www.tiktok.com/@vyra'],
      ],
    );
    assert.ok(m.social.every((s) => s.label.length > 0));
    assert.deepStrictEqual(m.address, ['12 Fife Avenue', 'Harare']);
    assert.deepStrictEqual(m.hours, ['Mon–Fri 09:00–17:30', 'Sat 09:00–13:00', 'Sun closed']);
    assert.strictEqual(m.holidayNote, 'Closed on public holidays');
    assert.strictEqual(m.phone, '+263 77 123 4567');
    assert.strictEqual(m.email, 'hello@vyra.example');
  });
});
