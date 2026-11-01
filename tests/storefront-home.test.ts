/**
 * ZP-488: VYRA home page, pure parts (src/components/storefront/home/home-model.ts).
 * - Section selection: every block hides when its data is missing.
 * - Hero image choice (settings first, lookbook fallback) and headline accent.
 * - Today's opening hours in the shop's time zone.
 * - Map link and category tile photo fallbacks.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  BRAND_BAND_LINE,
  FEATURED_LIMIT,
  NEW_ARRIVALS_LIMIT,
  SHOP_TIME_ZONE,
  TILE_FALLBACK_STEMS,
  buildHomeModel,
  categoryTiles,
  collectionColumns,
  dayInTimeZone,
  heroImages,
  mapLink,
  settingsImageData,
  splitHeadline,
  todaysHours,
} from '../src/components/storefront/home/home-model';
import { toPublicSiteSettings } from '../src/lib/site-settings/dto';
import { SITE_SETTINGS_DEFAULTS, type OpeningHours } from '../src/lib/site-settings/schema';
import type { PublicCategory, PublicImage, PublicProduct } from '../src/lib/storefront/dto';
import { LOOKBOOK } from '../src/components/storefront/lookbook';

const HEX_A = 'a'.repeat(32);
const HEX_B = 'b'.repeat(32);
const HEX_C = 'c'.repeat(32);

function settings(overrides: Partial<typeof SITE_SETTINGS_DEFAULTS> = {}) {
  return toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, ...overrides });
}

function image(hex: string, alt = 'photo'): PublicImage {
  return {
    url: `/api/images/public/${hex}.webp`,
    srcSet: `/api/images/public/${hex}.webp?w=320 320w`,
    alt,
    width: null,
    height: null,
  };
}

function product(slug: string, overrides: Partial<PublicProduct> = {}): PublicProduct {
  return {
    slug,
    name: slug,
    description: null,
    category: { slug: 'dresses', name: 'Dresses' },
    colours: null,
    sizes: null,
    availability: 'IN_STOCK',
    images: [image(HEX_A)],
    isNew: true,
    featured: false,
    priceUsd: null,
    ...overrides,
  };
}

function category(slug: string, heroImage: PublicImage | null = null): PublicCategory {
  return { slug, name: slug[0].toUpperCase() + slug.slice(1), description: null, heroImage };
}

const weekdays = { closed: false as const, open: '09:00', close: '17:30' };
const week: OpeningHours = {
  mon: weekdays,
  tue: weekdays,
  wed: weekdays,
  thu: weekdays,
  fri: weekdays,
  sat: { closed: false, open: '09:00', close: '13:00' },
  sun: { closed: true },
};

describe('splitHeadline: optional italic accent on the last word', () => {
  test('two or more words: the last word is the accent', () => {
    assert.deepStrictEqual(splitHeadline('Style Your Way'), { lead: 'Style Your', accent: 'Way' });
    assert.deepStrictEqual(splitHeadline('  Elevate   Your Style '), { lead: 'Elevate Your', accent: 'Style' });
  });
  test('one word: no accent', () => {
    assert.deepStrictEqual(splitHeadline('VYRA'), { lead: 'VYRA', accent: null });
  });
  test('blank falls back to the default headline', () => {
    assert.deepStrictEqual(splitHeadline('   '), { lead: 'Style Your', accent: 'Way' });
  });
});

describe('settingsImageData: settings picture URL -> img data with srcset', () => {
  test('public image URL gets a srcset of the allowed widths', () => {
    const img = settingsImageData(`/api/images/public/${HEX_A}.webp`, 'Hero');
    assert.ok(img);
    assert.strictEqual(img.src, `/api/images/public/${HEX_A}.webp`);
    assert.strictEqual(img.alt, 'Hero');
    assert.match(img.srcSet ?? '', new RegExp(`^/api/images/public/${HEX_A}\\.webp\\?w=320 320w, `));
    assert.match(img.srcSet ?? '', /\?w=1200 1200w$/);
    assert.doesNotMatch(img.srcSet ?? '', /1600w/);
  });
  test('null, blank or anything that is not a public picture URL is rejected', () => {
    assert.strictEqual(settingsImageData(null, 'x'), null);
    assert.strictEqual(settingsImageData('', 'x'), null);
    assert.strictEqual(settingsImageData('https://evil.test/a.webp', 'x'), null);
    assert.strictEqual(settingsImageData('/api/images/public/../x.webp', 'x'), null);
  });
});

describe('heroImages: settings first, then the lime-pleated-dress lookbook photo', () => {
  test('no settings pictures: lookbook photo, no desktop art direction', () => {
    const h = heroImages({ desktop: null, mobile: null });
    assert.strictEqual(h.source, 'lookbook');
    assert.strictEqual(h.image.src, LOOKBOOK['lime-pleated-dress'].large.src);
    assert.strictEqual(h.desktop, null);
  });
  test('only a desktop picture: used everywhere', () => {
    const h = heroImages({ desktop: `/api/images/public/${HEX_A}.webp`, mobile: null });
    assert.strictEqual(h.source, 'settings');
    assert.strictEqual(h.image.src, `/api/images/public/${HEX_A}.webp`);
    assert.strictEqual(h.desktop, null);
  });
  test('only a mobile picture: used everywhere', () => {
    const h = heroImages({ desktop: null, mobile: `/api/images/public/${HEX_B}.webp` });
    assert.strictEqual(h.image.src, `/api/images/public/${HEX_B}.webp`);
    assert.strictEqual(h.desktop, null);
  });
  test('both: mobile is the base image, desktop is the md+ source', () => {
    const h = heroImages({ desktop: `/api/images/public/${HEX_A}.webp`, mobile: `/api/images/public/${HEX_B}.webp` });
    assert.strictEqual(h.image.src, `/api/images/public/${HEX_B}.webp`);
    assert.strictEqual(h.desktop?.src, `/api/images/public/${HEX_A}.webp`);
  });
  test('the same picture twice: no art direction', () => {
    const url = `/api/images/public/${HEX_A}.webp`;
    assert.strictEqual(heroImages({ desktop: url, mobile: url }).desktop, null);
  });
});

describe("todaysHours: today's hours in the shop's time zone", () => {
  test('default time zone is Africa/Harare', () => {
    assert.strictEqual(SHOP_TIME_ZONE, 'Africa/Harare');
  });
  test('dayInTimeZone uses the shop date, not UTC', () => {
    // Sunday 2026-11-01 22:30 UTC is Monday 00:30 in Harare (UTC+2).
    const now = new Date('2026-11-01T22:30:00Z');
    assert.strictEqual(dayInTimeZone(now, 'UTC'), 'sun');
    assert.strictEqual(dayInTimeZone(now, 'Africa/Harare'), 'mon');
  });
  test('an open day', () => {
    const t = todaysHours(week, new Date('2026-11-02T10:00:00Z'), 'Africa/Harare'); // Monday
    assert.deepStrictEqual(t, { day: 'mon', dayLabel: 'Monday', open: true, text: '09:00–17:30' });
  });
  test('a closed day', () => {
    const t = todaysHours(week, new Date('2026-11-01T10:00:00Z'), 'Africa/Harare'); // Sunday
    assert.deepStrictEqual(t, { day: 'sun', dayLabel: 'Sunday', open: false, text: 'Closed' });
  });
  test('late Saturday UTC that is already Sunday in Harare', () => {
    const t = todaysHours(week, new Date('2026-10-31T23:00:00Z'), 'Africa/Harare');
    assert.strictEqual(t?.day, 'sun');
  });
  test('no hours set: null (hide)', () => {
    assert.strictEqual(todaysHours(null, new Date(), 'Africa/Harare'), null);
  });
  test('an invalid time zone falls back to the shop default instead of throwing', () => {
    const t = todaysHours(week, new Date('2026-11-01T22:30:00Z'), 'Not/AZone');
    assert.strictEqual(t?.day, 'mon');
  });
});

describe('mapLink', () => {
  const none = { address: null, mapUrl: null, latitude: null, longitude: null };
  test("the owner's map URL wins", () => {
    assert.strictEqual(
      mapLink({ ...none, address: '1 Main St', mapUrl: 'https://maps.app.goo.gl/abc' }),
      'https://maps.app.goo.gl/abc',
    );
  });
  test('otherwise a Google Maps search for the address (lines joined with commas)', () => {
    assert.strictEqual(
      mapLink({ ...none, address: 'Shop 4, Sam Levy Village\nBorrowdale\n\nHarare' }),
      'https://www.google.com/maps/search/?api=1&query=Shop%204%2C%20Sam%20Levy%20Village%2C%20Borrowdale%2C%20Harare',
    );
  });
  test('otherwise the coordinates', () => {
    assert.strictEqual(
      mapLink({ ...none, latitude: -17.76, longitude: 31.08 }),
      'https://www.google.com/maps/search/?api=1&query=-17.76%2C31.08',
    );
  });
  test('nothing set: null', () => {
    assert.strictEqual(mapLink(none), null);
    assert.strictEqual(mapLink({ ...none, address: '  \n ' }), null);
  });
});

describe('categoryTiles: hero image, then first product photo, then a rotating lookbook photo', () => {
  test('uses the category hero image when set', () => {
    const [t] = categoryTiles([category('dresses', image(HEX_A, 'Dresses hero'))], {});
    assert.strictEqual(t.source, 'hero');
    assert.strictEqual(t.image.src, `/api/images/public/${HEX_A}.webp`);
    assert.strictEqual(t.image.alt, '', 'decorative: the link names the tile');
  });
  test("then the category's first product photo", () => {
    const [t] = categoryTiles([category('tops')], { tops: image(HEX_B) });
    assert.strictEqual(t.source, 'product');
    assert.strictEqual(t.image.src, `/api/images/public/${HEX_B}.webp`);
  });
  test('then lookbook photos, rotating so neighbouring tiles differ', () => {
    const tiles = categoryTiles([category('a'), category('b', image(HEX_C)), category('c'), category('d')], {});
    assert.deepStrictEqual(
      tiles.map((t) => t.source),
      ['lookbook', 'hero', 'lookbook', 'lookbook'],
    );
    const lookbookSrcs = tiles.filter((t) => t.source === 'lookbook').map((t) => t.image.src);
    assert.deepStrictEqual(lookbookSrcs, [
      LOOKBOOK[TILE_FALLBACK_STEMS[0]].large.src,
      LOOKBOOK[TILE_FALLBACK_STEMS[1]].large.src,
      LOOKBOOK[TILE_FALLBACK_STEMS[2]].large.src,
    ]);
  });
  test('the rotation wraps around and never starts with the hero photo', () => {
    const many = Array.from({ length: TILE_FALLBACK_STEMS.length + 1 }, (_, i) => category(`c${i}`));
    const tiles = categoryTiles(many, {});
    assert.strictEqual(tiles[TILE_FALLBACK_STEMS.length].image.src, tiles[0].image.src);
    assert.notStrictEqual(TILE_FALLBACK_STEMS[0], 'lime-pleated-dress');
  });
});

describe('collectionColumns: 3 or 4 desktop columns, whichever leaves fewer gaps', () => {
  test('counts', () => {
    assert.deepStrictEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map(collectionColumns),
      [2, 2, 3, 4, 3, 3, 4, 4, 3, 4, 4],
    );
  });
});

describe('buildHomeModel: sections and links', () => {
  const now = new Date('2026-11-02T10:00:00Z'); // Monday in Harare
  const empty = { settings: settings(), newArrivals: [], featured: [], categories: [], categoryCovers: {}, base: '/site' as const, now };

  test('nothing published, default settings: only hero, trust strip, brand band and statement', () => {
    const m = buildHomeModel(empty);
    assert.strictEqual(m.newArrivals, null);
    assert.strictEqual(m.collections, null);
    assert.strictEqual(m.featured, null);
    assert.strictEqual(m.visit, null);
    assert.deepStrictEqual(m.hero.headline, { lead: 'Style Your', accent: 'Way' });
    assert.strictEqual(m.hero.subline, 'Premium fashion. Modern you.');
    assert.strictEqual(m.hero.image.source, 'lookbook');
    assert.deepStrictEqual(m.trustLabels, ['Premium Quality', 'Visit Our Store', 'Enquire on WhatsApp']);
    assert.strictEqual(m.brandBand.line, BRAND_BAND_LINE);
    assert.strictEqual(m.brandBand.tagline, 'WEAR DIFFERENT.');
    assert.strictEqual(m.statement, 'Confidence in every stitch');
  });

  test('links are prefixed for the admin/UAT host', () => {
    const m = buildHomeModel(empty);
    assert.deepStrictEqual(m.links, {
      shop: '/site/shop',
      newArrivals: '/site/new',
      collections: '/site/collections',
      about: '/site/about',
      visit: '/site/visit',
    });
    assert.strictEqual(m.productHref('a b'), '/site/p/a%20b');
  });

  test('links are clean on the storefront host', () => {
    const m = buildHomeModel({ ...empty, base: '' });
    assert.strictEqual(m.links.shop, '/shop');
    assert.strictEqual(m.productHref('x'), '/p/x');
  });

  test(`new arrivals: up to ${NEW_ARRIVALS_LIMIT}, only isNew`, () => {
    const items = Array.from({ length: 10 }, (_, i) => product(`p${i}`));
    items[1] = product('old', { isNew: false });
    const m = buildHomeModel({ ...empty, newArrivals: items });
    assert.strictEqual(m.newArrivals?.length, NEW_ARRIVALS_LIMIT);
    assert.ok(!m.newArrivals?.some((p) => p.slug === 'old'));
  });

  test(`featured: up to ${FEATURED_LIMIT}, in the given (admin) order, only featured`, () => {
    const items = ['f3', 'f1', 'x', 'f2', 'f4', 'f5'].map((s) => product(s, { featured: s !== 'x' }));
    const m = buildHomeModel({ ...empty, featured: items });
    assert.deepStrictEqual(m.featured?.products.map((p) => p.slug), ['f3', 'f1', 'f2', 'f4']);
    assert.ok(m.featured?.image.src.startsWith('/brand/lookbook/'));
  });

  test('collections: one tile per published category, linked to its page', () => {
    const m = buildHomeModel({ ...empty, categories: [category('dresses'), category('sets')] });
    assert.deepStrictEqual(
      m.collections?.map((t) => [t.name, t.href]),
      [
        ['Dresses', '/site/collections/dresses'],
        ['Sets', '/site/collections/sets'],
      ],
    );
  });

  test('settings hero copy and pictures are used', () => {
    const m = buildHomeModel({
      ...empty,
      settings: settings({ heroHeadline: 'Be Bold', heroSubline: 'New season.', heroImageKeyDesktop: `products/${HEX_A}.webp` }),
    });
    assert.deepStrictEqual(m.hero.headline, { lead: 'Be', accent: 'Bold' });
    assert.strictEqual(m.hero.subline, 'New season.');
    assert.strictEqual(m.hero.image.source, 'settings');
  });

  test('visit: each piece appears only when set', () => {
    const onlyAddress = buildHomeModel({ ...empty, settings: settings({ address: '1 Main St\nHarare' }) });
    assert.deepStrictEqual(onlyAddress.visit, {
      address: ['1 Main St', 'Harare'],
      today: null,
      holidayNote: null,
      mapHref: 'https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Harare',
      whatsappHref: null,
    });

    const onlyHours = buildHomeModel({ ...empty, settings: settings({ openingHours: week }) });
    assert.deepStrictEqual(onlyHours.visit?.address, []);
    assert.strictEqual(onlyHours.visit?.today?.text, '09:00–17:30');
    assert.strictEqual(onlyHours.visit?.mapHref, null);

    const onlyWhatsApp = buildHomeModel({ ...empty, settings: settings({ whatsappNumber: '+263771234567' }) });
    assert.match(onlyWhatsApp.visit?.whatsappHref ?? '', /^https:\/\/wa\.me\/263771234567\?text=/);
  });

  test('visit: a holiday note alone does not make the section show', () => {
    const m = buildHomeModel({ ...empty, settings: settings({ holidayNote: 'Closed 25 Dec' }) });
    assert.strictEqual(m.visit, null);
  });
});
