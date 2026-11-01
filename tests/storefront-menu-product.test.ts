/**
 * ZP-503: the refreshed menu and product page, pure parts.
 * - The menu model (src/lib/storefront/menu-model.ts): collections rows with
 *   "N looks", About excerpt, Visit us (today's hours, week, address,
 *   directions), the guide link, WhatsApp, socials. Missing data is hidden.
 * - The product page back button (src/lib/storefront/back-target.ts).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { toPublicSiteSettings } from '../src/lib/site-settings/dto';
import { SITE_SETTINGS_DEFAULTS, type OpeningHours, type SiteSettingsData } from '../src/lib/site-settings/schema';
import {
  aboutExcerpt,
  buildMenuModel,
  buildStoreVisit,
  GUIDE_PARAM,
  todayLine,
} from '../src/lib/storefront/menu-model';
import { feedLookHref, isHomePath, shouldGoBack } from '../src/lib/storefront/back-target';
import { productPageEnquiryHref } from '../src/lib/storefront/product-page-enquiry';

const HOURS: OpeningHours = {
  mon: { closed: false, open: '09:00', close: '17:30' },
  tue: { closed: false, open: '09:00', close: '17:30' },
  wed: { closed: false, open: '09:00', close: '17:30' },
  thu: { closed: false, open: '09:00', close: '17:30' },
  fri: { closed: false, open: '09:00', close: '17:30' },
  sat: { closed: false, open: '09:00', close: '14:00' },
  sun: { closed: true },
};

function settings(overrides: Partial<SiteSettingsData> = {}) {
  return toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, ...overrides });
}

const FULL = {
  whatsappNumber: '+263771234567',
  address: 'Shop 4, Sam Levy Village\nBorrowdale, Harare',
  openingHours: HOURS,
  aboutStory: 'VYRA started with one rail of dresses.\n\nNow it is a whole store.',
  instagramUrl: 'https://instagram.com/vyra',
  latitude: -17.76,
  longitude: 31.09,
} satisfies Partial<SiteSettingsData>;

const TABS = [
  { id: 'new', label: 'New in', count: 6 },
  { id: 'dresses', label: 'Dresses', count: 4 },
  { id: 'co-ord-sets', label: 'Co-ord Sets', count: 1 },
];

// 2026-11-02 is a Monday; 10:00 UTC is 12:00 in Harare.
const MONDAY = new Date('2026-11-02T10:00:00Z');
const SUNDAY = new Date('2026-11-01T10:00:00Z');

describe('todayLine: today in the shop time zone', () => {
  test('open day', () => {
    assert.deepStrictEqual(todayLine(HOURS, MONDAY), { text: 'Open today 09:00–17:30', open: true });
  });
  test('closed day', () => {
    assert.deepStrictEqual(todayLine(HOURS, SUNDAY), { text: 'Closed today', open: false });
  });
  test('uses the shop time zone, not UTC (23:30 UTC Sunday is Monday in Harare)', () => {
    assert.strictEqual(todayLine(HOURS, new Date('2026-11-01T23:30:00Z'))?.open, true);
  });
  test('no hours set: null', () => {
    assert.strictEqual(todayLine(null, MONDAY), null);
  });
});

describe('aboutExcerpt', () => {
  test('first paragraph of the story', () => {
    assert.strictEqual(aboutExcerpt(FULL.aboutStory), 'VYRA started with one rail of dresses.');
  });
  test('long text is cut at a word with an ellipsis', () => {
    const long = 'word '.repeat(80).trim();
    const out = aboutExcerpt(long) as string;
    assert.ok(out.length <= 181, `length ${out.length}`);
    assert.ok(out.endsWith('…'));
    assert.ok(!out.includes('wor…'));
  });
  test('missing or placeholder story: null', () => {
    assert.strictEqual(aboutExcerpt(null), null);
    assert.strictEqual(aboutExcerpt('  '), null);
    assert.strictEqual(aboutExcerpt('TBC'), null);
  });
});

describe('buildStoreVisit', () => {
  test('week lines, address, directions, raw hours', () => {
    const v = buildStoreVisit(settings(FULL));
    assert.ok(v);
    assert.deepStrictEqual(v.week, ['Mon–Fri 09:00–17:30', 'Sat 09:00–14:00', 'Sun closed']);
    assert.deepStrictEqual(v.address, ['Shop 4, Sam Levy Village', 'Borrowdale, Harare']);
    assert.match(v.directionsHref ?? '', /^https:\/\/www\.google\.com\/maps\/dir\//);
    assert.deepStrictEqual(v.hours, HOURS);
  });
  test('placeholder address is hidden, never TBC', () => {
    const v = buildStoreVisit(settings({ ...FULL, address: 'TBC', latitude: null, longitude: null }));
    assert.ok(v);
    assert.deepStrictEqual(v.address, []);
    assert.strictEqual(v.directionsHref, null);
    assert.ok(!JSON.stringify(v).includes('TBC'));
  });
  test('nothing set: null', () => {
    assert.strictEqual(buildStoreVisit(settings()), null);
  });
});

describe('buildMenuModel', () => {
  test('collections: New in to the landing feed, categories to /?c=<slug>, with N looks', () => {
    const m = buildMenuModel({ settings: settings(FULL), tabs: TABS, base: '/site' });
    assert.deepStrictEqual(m.collections, [
      { id: 'new', label: 'New in', href: '/site', count: '6 looks' },
      { id: 'dresses', label: 'Dresses', href: '/site?c=dresses', count: '4 looks' },
      { id: 'co-ord-sets', label: 'Co-ord Sets', href: '/site?c=co-ord-sets', count: '1 look' },
    ]);
  });
  test('clean paths on the storefront host', () => {
    const m = buildMenuModel({ settings: settings(FULL), tabs: TABS, base: '' });
    assert.strictEqual(m.collections[0].href, '/');
    assert.strictEqual(m.collections[1].href, '/?c=dresses');
    assert.strictEqual(m.guideHref, `/?${GUIDE_PARAM}=1`);
    assert.strictEqual(m.aboutHref, '/about');
    assert.strictEqual(m.visitHref, '/visit');
  });
  test('the guide link opens the landing page with ?guide=1', () => {
    const m = buildMenuModel({ settings: settings(FULL), tabs: TABS, base: '/site' });
    assert.strictEqual(GUIDE_PARAM, 'guide');
    assert.strictEqual(m.guideHref, '/site?guide=1');
  });
  test('slugs are encoded', () => {
    const m = buildMenuModel({ settings: settings(), tabs: [{ id: 'a b', label: 'A', count: 2 }], base: '' });
    assert.strictEqual(m.collections[0].href, '/?c=a%20b');
  });
  test('a zero count shows no count', () => {
    const m = buildMenuModel({ settings: settings(), tabs: [{ id: 'new', label: 'New in', count: 0 }], base: '' });
    assert.deepStrictEqual(m.collections, [{ id: 'new', label: 'New in', href: '/', count: null }]);
  });
  test('full settings: about excerpt, visit, WhatsApp general enquiry, socials, tagline', () => {
    const m = buildMenuModel({ settings: settings(FULL), tabs: TABS, base: '/site' });
    assert.strictEqual(m.about, 'VYRA started with one rail of dresses.');
    assert.ok(m.visit);
    assert.match(m.whatsappHref ?? '', /^https:\/\/wa\.me\/263771234567\?text=/);
    assert.deepStrictEqual(m.social.map((s) => s.icon), ['instagram']);
    assert.strictEqual(m.tagline, 'WEAR DIFFERENT.');
  });
  test('nothing set: about, visit and WhatsApp hidden', () => {
    const m = buildMenuModel({ settings: settings(), tabs: TABS, base: '/site' });
    assert.strictEqual(m.about, null);
    assert.strictEqual(m.visit, null);
    assert.strictEqual(m.whatsappHref, null);
    assert.deepStrictEqual(m.social, []);
  });
});

describe('product page back button', () => {
  const base = { origin: 'https://vyra.example', referrer: '', historyLength: 2 };

  test('came from the feed inside the app: history.back()', () => {
    assert.strictEqual(shouldGoBack({ ...base, previousPath: '/site', homeHref: '/site' }), true);
    assert.strictEqual(shouldGoBack({ ...base, previousPath: '/site/', homeHref: '/site' }), true);
    assert.strictEqual(shouldGoBack({ ...base, previousPath: '/', homeHref: '/' }), true);
  });
  test('came from another page inside the app: link to the feed', () => {
    assert.strictEqual(shouldGoBack({ ...base, previousPath: '/site/p/other', homeHref: '/site' }), false);
    assert.strictEqual(shouldGoBack({ ...base, previousPath: '/site/shop', homeHref: '/site' }), false);
  });
  test('first page of the visit: same-origin landing referrer goes back', () => {
    const input = { ...base, previousPath: null, homeHref: '/' };
    assert.strictEqual(shouldGoBack({ ...input, referrer: 'https://vyra.example/' }), true);
    assert.strictEqual(shouldGoBack({ ...input, referrer: 'https://vyra.example/?c=dresses#look-x' }), true);
  });
  test('other referrers: link to the feed', () => {
    const input = { ...base, previousPath: null, homeHref: '/' };
    assert.strictEqual(shouldGoBack({ ...input, referrer: '' }), false);
    assert.strictEqual(shouldGoBack({ ...input, referrer: 'https://evil.example/' }), false);
    assert.strictEqual(shouldGoBack({ ...input, referrer: 'https://vyra.example/shop' }), false);
    assert.strictEqual(shouldGoBack({ ...input, referrer: 'not a url' }), false);
  });
  test('no history to go back to: link', () => {
    assert.strictEqual(shouldGoBack({ ...base, historyLength: 1, previousPath: '/site', homeHref: '/site' }), false);
  });
  test('feed link opens the feed at this look', () => {
    assert.strictEqual(feedLookHref('/site', 'lime-wrap-dress'), '/site#look-lime-wrap-dress');
    assert.strictEqual(feedLookHref('/', 'lime-wrap-dress'), '/#look-lime-wrap-dress');
  });
  test('isHomePath', () => {
    assert.strictEqual(isHomePath('/site', '/site'), true);
    assert.strictEqual(isHomePath('/site/', '/site'), true);
    assert.strictEqual(isHomePath('/', '/'), true);
    assert.strictEqual(isHomePath('/site/shop', '/site'), false);
  });
});

describe('product page enquiry link', () => {
  const contacts = settings({ whatsappNumber: '+263771234567' }).contacts;
  const text = (href: string | null) => decodeURIComponent((href ?? '').split('?text=')[1] ?? '');

  test('available: the enquiry template with name, url, colour and size', () => {
    const href = productPageEnquiryHref(contacts, 'IN_STOCK', { name: 'Lime wrap dress', url: 'https://vyra.example/p/lime', colour: 'Lime', size: 'M' });
    assert.match(text(href), /^Hi VYRA, I'm interested in Lime wrap dress \(https:\/\/vyra\.example\/p\/lime\)/);
    assert.match(text(href), /Colour: Lime\nSize: M/);
  });
  test('sold out: the restock message (as in the feed), with colour and size', () => {
    const href = productPageEnquiryHref(contacts, 'SOLD_OUT', { name: 'Lime wrap dress', url: 'https://vyra.example/p/lime' });
    assert.strictEqual(text(href), 'Hi VYRA, please let me know when the Lime wrap dress is back in stock. (https://vyra.example/p/lime)');
    const sized = productPageEnquiryHref(contacts, 'SOLD_OUT', { name: 'Lime wrap dress', url: null, size: 'M' });
    assert.strictEqual(text(sized), 'Hi VYRA, please let me know when the Lime wrap dress is back in stock.\nSize: M');
  });
  test('no WhatsApp number: null', () => {
    assert.strictEqual(productPageEnquiryHref(settings().contacts, 'SOLD_OUT', { name: 'X', url: null }), null);
  });
});
