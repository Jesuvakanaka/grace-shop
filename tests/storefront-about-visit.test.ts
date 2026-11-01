/**
 * ZP-491: About and Visit us pages, pure parts
 * (src/components/storefront/info/info-model.ts).
 * - Week hours with today highlighted in the shop's time zone.
 * - Map / directions link choice and the click-to-load embed URL.
 * - Which blocks show (every block hides when its value is missing).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  ABOUT_FALLBACK_STEM,
  DEFAULT_ABOUT_HEADLINE,
  DEFAULT_MEANING,
  SHOP_TIME_ZONE,
  VISIT_IMAGE_STEM,
  buildAboutModel,
  buildVisitModel,
  dayInTimeZone,
  directionsLink,
  mapEmbedUrl,
  mapLink,
  meaningfulText,
  storyParagraphs,
  telHref,
  weekHours,
} from '../src/components/storefront/info/info-model';
import { toPublicSiteSettings, type PublicSiteSettings } from '../src/lib/site-settings/dto';
import { SITE_SETTINGS_DEFAULTS, type OpeningHours, type SiteSettingsData } from '../src/lib/site-settings/schema';
import { lookbookImage } from '../src/components/storefront/lookbook';
import {
  addressLines,
  mapLink as sharedMapLink,
  meaningfulText as sharedMeaningfulText,
} from '../src/lib/storefront/visit-model';
import { buildShellModel } from '../src/lib/storefront/shell-model';
import { buildHomeModel } from '../src/components/storefront/home/home-model';

const HOURS: OpeningHours = {
  mon: { closed: false, open: '09:00', close: '17:30' },
  tue: { closed: false, open: '09:00', close: '17:30' },
  wed: { closed: false, open: '09:00', close: '17:30' },
  thu: { closed: false, open: '09:00', close: '17:30' },
  fri: { closed: false, open: '09:00', close: '18:00' },
  sat: { closed: false, open: '09:00', close: '13:00' },
  sun: { closed: true },
};

function settings(overrides: Partial<SiteSettingsData> = {}): PublicSiteSettings {
  return toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, ...overrides });
}

const FILLED: Partial<SiteSettingsData> = {
  whatsappNumber: '+263771234567',
  phone: '+263 77 123 4567',
  email: 'hello@vyra.example',
  address: 'Shop 12, Sam Levy Village\n\nBorrowdale\nHarare',
  openingHours: HOURS,
  holidayNote: 'Closed on public holidays.',
  instagramUrl: 'https://www.instagram.com/vyra',
  aboutHeadline: 'Made for the bold',
  aboutStory: 'VYRA began in Harare.\n\nWe pick every piece by hand.',
  aboutImageKey: 'products/0123456789abcdef0123456789abcdef.webp',
};

// 2026-11-02 is a Monday. 22:30 UTC is already Tuesday 00:30 in Harare (UTC+2).
const MONDAY_NOON_UTC = new Date('2026-11-02T12:00:00Z');
const MONDAY_LATE_UTC = new Date('2026-11-02T22:30:00Z');

describe('dayInTimeZone', () => {
  test('defaults to Africa/Harare', () => {
    assert.strictEqual(SHOP_TIME_ZONE, 'Africa/Harare');
    assert.strictEqual(dayInTimeZone(MONDAY_NOON_UTC), 'mon');
    assert.strictEqual(dayInTimeZone(MONDAY_LATE_UTC), 'tue');
  });

  test('honours another zone, and an invalid zone falls back to the shop zone', () => {
    assert.strictEqual(dayInTimeZone(MONDAY_LATE_UTC, 'UTC'), 'mon');
    assert.strictEqual(dayInTimeZone(MONDAY_LATE_UTC, 'Not/AZone'), 'tue');
  });
});

describe('weekHours: the week with today marked', () => {
  test('null when no hours are set', () => {
    assert.strictEqual(weekHours(null, MONDAY_NOON_UTC), null);
  });

  test('seven rows Monday to Sunday, exactly one today', () => {
    const rows = weekHours(HOURS, MONDAY_NOON_UTC)!;
    assert.strictEqual(rows.length, 7);
    assert.deepStrictEqual(
      rows.map((r) => r.day),
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    );
    assert.deepStrictEqual(
      rows.filter((r) => r.isToday).map((r) => r.day),
      ['mon'],
    );
    assert.deepStrictEqual(rows[0], {
      day: 'mon',
      label: 'Monday',
      text: '09:00–17:30',
      closed: false,
      isToday: true,
    });
    assert.deepStrictEqual(rows[6], { day: 'sun', label: 'Sunday', text: 'Closed', closed: true, isToday: false });
  });

  test('today follows the shop time zone, not UTC', () => {
    const rows = weekHours(HOURS, MONDAY_LATE_UTC)!;
    assert.deepStrictEqual(
      rows.filter((r) => r.isToday).map((r) => r.day),
      ['tue'],
    );
    const utcRows = weekHours(HOURS, MONDAY_LATE_UTC, 'UTC')!;
    assert.deepStrictEqual(
      utcRows.filter((r) => r.isToday).map((r) => r.day),
      ['mon'],
    );
  });
});

describe('map links', () => {
  const none = { address: null, mapUrl: null, latitude: null, longitude: null };

  test('owner map URL wins', () => {
    assert.strictEqual(
      mapLink({ ...none, address: 'Harare', mapUrl: 'https://maps.app.goo.gl/abc' }),
      'https://maps.app.goo.gl/abc',
    );
  });

  test('else a Google Maps search for the address lines joined with commas', () => {
    assert.strictEqual(
      mapLink({ ...none, address: 'Shop 12\n Sam Levy Village \n\nHarare' }),
      'https://www.google.com/maps/search/?api=1&query=Shop%2012%2C%20Sam%20Levy%20Village%2C%20Harare',
    );
  });

  test('else the coordinates; null when nothing is set', () => {
    assert.strictEqual(
      mapLink({ ...none, latitude: -17.76, longitude: 31.08 }),
      'https://www.google.com/maps/search/?api=1&query=-17.76%2C31.08',
    );
    assert.strictEqual(mapLink(none), null);
    assert.strictEqual(mapLink({ ...none, address: '  \n ' }), null);
  });

  test('an owner map URL that is not https is ignored (address / coordinates instead)', () => {
    for (const bad of ['http://maps.example/x', 'javascript:alert(1)', 'https://user:pw@maps.example/', 'not a url']) {
      assert.strictEqual(
        mapLink({ ...none, address: 'Harare', mapUrl: bad }),
        'https://www.google.com/maps/search/?api=1&query=Harare',
        bad,
      );
      assert.strictEqual(
        directionsLink({ ...none, address: 'Harare', mapUrl: bad }),
        'https://www.google.com/maps/dir/?api=1&destination=Harare',
        bad,
      );
      assert.strictEqual(mapLink({ ...none, mapUrl: bad }), null, bad);
      assert.strictEqual(directionsLink({ ...none, mapUrl: bad }), null, bad);
    }
  });

  test('a placeholder address is ignored by the map links', () => {
    assert.strictEqual(mapLink({ ...none, address: 'TBC' }), null);
    assert.strictEqual(directionsLink({ ...none, address: 'TBC' }), null);
    assert.strictEqual(mapEmbedUrl({ ...none, address: 'TBC' }), null);
  });

  test('directions: Google Maps directions to the address or coordinates, else the owner map URL', () => {
    assert.strictEqual(
      directionsLink({ ...none, address: 'Harare', mapUrl: 'https://maps.app.goo.gl/abc' }),
      'https://www.google.com/maps/dir/?api=1&destination=Harare',
    );
    assert.strictEqual(
      directionsLink({ ...none, address: 'Harare', latitude: -17.76, longitude: 31.08 }),
      'https://www.google.com/maps/dir/?api=1&destination=-17.76%2C31.08',
    );
    assert.strictEqual(directionsLink({ ...none, mapUrl: 'https://maps.app.goo.gl/abc' }), 'https://maps.app.goo.gl/abc');
    assert.strictEqual(directionsLink(none), null);
  });

  test('embed: coordinates first, else the address; null without either (no embed of an arbitrary URL)', () => {
    assert.strictEqual(
      mapEmbedUrl({ ...none, address: 'Harare', latitude: -17.76, longitude: 31.08 }),
      'https://www.google.com/maps?q=-17.76%2C31.08&output=embed',
    );
    assert.strictEqual(
      mapEmbedUrl({ ...none, address: 'Shop 12\nHarare' }),
      'https://www.google.com/maps?q=Shop%2012%2C%20Harare&output=embed',
    );
    assert.strictEqual(mapEmbedUrl({ ...none, mapUrl: 'https://maps.app.goo.gl/abc' }), null);
  });
});

describe('small text helpers', () => {
  test('telHref keeps digits and a leading plus', () => {
    assert.strictEqual(telHref('+263 (77) 123-4567'), 'tel:+263771234567');
    assert.strictEqual(telHref('  '), null);
    assert.strictEqual(telHref(null), null);
  });

  test('meaningfulText drops blanks and placeholders such as TBC', () => {
    assert.strictEqual(meaningfulText('  Hello  '), 'Hello');
    for (const v of [null, '', '   ', 'TBC', 'tbc.', 'TBA', 'TBD', 'Coming soon', '-', '...']) {
      assert.strictEqual(meaningfulText(v), null, String(v));
    }
  });

  test('storyParagraphs splits on blank lines and drops placeholders', () => {
    assert.deepStrictEqual(storyParagraphs('One.\nStill one.\n\n\nTwo.\r\n\r\nThree.'), [
      'One.\nStill one.',
      'Two.',
      'Three.',
    ]);
    assert.deepStrictEqual(storyParagraphs('TBC'), []);
    assert.deepStrictEqual(storyParagraphs(null), []);
  });
});

describe('buildAboutModel', () => {
  test('filled settings: headline, story, settings image, /shop link', () => {
    const m = buildAboutModel({ settings: settings(FILLED), base: '/site' });
    assert.strictEqual(m.headline, 'Made for the bold');
    assert.deepStrictEqual(m.story, ['VYRA began in Harare.', 'We pick every piece by hand.']);
    assert.strictEqual(m.image.source, 'settings');
    assert.strictEqual(m.image.image.src, '/api/images/public/0123456789abcdef0123456789abcdef.webp');
    assert.match(m.image.image.srcSet ?? '', /\?w=\d+ \d+w/);
    assert.ok(m.image.image.alt.length > 0);
    assert.strictEqual(m.meaning.title, 'What WEAR DIFFERENT. means');
    assert.strictEqual(m.meaning.text, DEFAULT_MEANING);
    assert.strictEqual(m.shopHref, '/site/shop');
  });

  test('empty settings: default headline, no story, lookbook image, never TBC', () => {
    const m = buildAboutModel({ settings: settings({ aboutStory: 'TBC' }), base: '' });
    assert.strictEqual(m.headline, DEFAULT_ABOUT_HEADLINE);
    assert.strictEqual(m.story, null);
    assert.strictEqual(m.image.source, 'lookbook');
    assert.deepStrictEqual(m.image.image, lookbookImage(ABOUT_FALLBACK_STEM));
    assert.strictEqual(ABOUT_FALLBACK_STEM, 'olive-print-pleated-dress');
    assert.strictEqual(m.shopHref, '/shop');
    assert.doesNotMatch(JSON.stringify(m), /TBC/);
  });

  test('default meaning copy is 2 to 3 sentences, second person, no hype', () => {
    const sentences = DEFAULT_MEANING.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 2 && sentences.length <= 3, DEFAULT_MEANING);
    assert.match(DEFAULT_MEANING, /\byou\b/i);
    assert.doesNotMatch(DEFAULT_MEANING, /!|amazing|ultimate|best|revolution/i);
  });
});

describe('buildVisitModel: blocks show only when set', () => {
  test('filled settings: every block present', () => {
    const m = buildVisitModel({ settings: settings(FILLED), now: MONDAY_NOON_UTC });
    assert.deepStrictEqual(m.address, ['Shop 12, Sam Levy Village', 'Borrowdale', 'Harare']);
    assert.strictEqual(m.hours?.length, 7);
    assert.strictEqual(m.hours?.find((r) => r.isToday)?.day, 'mon');
    assert.strictEqual(m.holidayNote, 'Closed on public holidays.');
    assert.deepStrictEqual(m.phone, { display: '+263 77 123 4567', href: 'tel:+263771234567' });
    assert.deepStrictEqual(m.email, { display: 'hello@vyra.example', href: 'mailto:hello@vyra.example' });
    assert.match(m.whatsappHref ?? '', /^https:\/\/wa\.me\/263771234567\?text=/);
    assert.match(m.map?.openHref ?? '', /^https:\/\/www\.google\.com\/maps\/search\//);
    assert.match(m.map?.directionsHref ?? '', /^https:\/\/www\.google\.com\/maps\/dir\//);
    assert.match(m.map?.embedSrc ?? '', /output=embed$/);
    assert.deepStrictEqual(
      m.social.map((s) => s.icon),
      ['instagram'],
    );
    assert.deepStrictEqual(m.image, lookbookImage(VISIT_IMAGE_STEM));
    assert.strictEqual(VISIT_IMAGE_STEM, 'olive-print-jumpsuit');
    assert.strictEqual(m.hasDetails, true);
  });

  test('empty settings: every block hidden', () => {
    const m = buildVisitModel({ settings: settings(), now: MONDAY_NOON_UTC });
    assert.deepStrictEqual(m.address, []);
    assert.strictEqual(m.hours, null);
    assert.strictEqual(m.holidayNote, null);
    assert.strictEqual(m.phone, null);
    assert.strictEqual(m.email, null);
    assert.strictEqual(m.whatsappHref, null);
    assert.strictEqual(m.map, null);
    assert.deepStrictEqual(m.social, []);
    assert.strictEqual(m.hasDetails, false);
  });

  test('owner map URL alone: map links but no embed', () => {
    const m = buildVisitModel({ settings: settings({ mapUrl: 'https://maps.app.goo.gl/abc' }), now: MONDAY_NOON_UTC });
    assert.deepStrictEqual(m.map, {
      openHref: 'https://maps.app.goo.gl/abc',
      directionsHref: 'https://maps.app.goo.gl/abc',
      embedSrc: null,
    });
    assert.strictEqual(m.hasDetails, true);
  });

  test('a placeholder address counts as missing: no address, no map', () => {
    const m = buildVisitModel({ settings: settings({ address: 'TBC' }), now: MONDAY_NOON_UTC });
    assert.deepStrictEqual(m.address, []);
    assert.strictEqual(m.map, null);
    assert.strictEqual(m.hasDetails, false);
  });

  test('a placeholder address with coordinates or a map URL: map from those', () => {
    const coords = buildVisitModel({
      settings: settings({ address: 'TBC', latitude: -17.76, longitude: 31.08 }),
      now: MONDAY_NOON_UTC,
    });
    assert.deepStrictEqual(coords.address, []);
    assert.deepStrictEqual(coords.map, {
      openHref: 'https://www.google.com/maps/search/?api=1&query=-17.76%2C31.08',
      directionsHref: 'https://www.google.com/maps/dir/?api=1&destination=-17.76%2C31.08',
      embedSrc: 'https://www.google.com/maps?q=-17.76%2C31.08&output=embed',
    });
    const url = buildVisitModel({ settings: settings({ address: 'TBC', mapUrl: 'https://maps.app.goo.gl/abc' }), now: MONDAY_NOON_UTC });
    assert.deepStrictEqual(url.address, []);
    assert.deepStrictEqual(url.map, {
      openHref: 'https://maps.app.goo.gl/abc',
      directionsHref: 'https://maps.app.goo.gl/abc',
      embedSrc: null,
    });
  });

  test('a placeholder holiday note is hidden', () => {
    const m = buildVisitModel({ settings: settings({ holidayNote: 'TBC' }), now: MONDAY_NOON_UTC });
    assert.strictEqual(m.holidayNote, null);
  });
});

describe('shared visit-model: placeholders hidden everywhere', () => {
  test('addressLines drops placeholder lines; the info model re-exports the shared helpers', () => {
    assert.deepStrictEqual(addressLines('TBC'), []);
    assert.deepStrictEqual(addressLines(' 12 Fife Avenue \n tbc \n Harare '), ['12 Fife Avenue', 'Harare']);
    assert.strictEqual(sharedMapLink, mapLink);
    assert.strictEqual(sharedMeaningfulText, meaningfulText);
  });

  test('shell footer: a TBC address or holiday note is hidden', () => {
    const m = buildShellModel({ settings: settings({ address: 'TBC', holidayNote: 'TBC' }), categories: [], base: '' });
    assert.deepStrictEqual(m.address, []);
    assert.strictEqual(m.holidayNote, null);
  });

  test('home: a TBC address hides the visit teaser, holiday note and map link', () => {
    const base = { newArrivals: [], featured: [], categories: [], categoryCovers: {}, base: '' as const, now: MONDAY_NOON_UTC };
    assert.strictEqual(buildHomeModel({ ...base, settings: settings({ address: 'TBC' }) }).visit, null);
    const m = buildHomeModel({
      ...base,
      settings: settings({ address: 'TBC', holidayNote: 'TBC', openingHours: HOURS }),
    });
    assert.deepStrictEqual(m.visit?.address, []);
    assert.strictEqual(m.visit?.holidayNote, null);
    assert.strictEqual(m.visit?.mapHref, null);
  });
});
