/**
 * ZP-491 / ZP-514: the shared visit helpers (src/lib/storefront/visit-model.ts)
 * that the menu's Visit us and the details card use (the About / Visit us
 * pages folded into the feed's menu in ZP-514).
 * - Days in the shop's time zone, map / directions / embed links.
 * - Placeholders (TBC) hidden everywhere.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { toPublicSiteSettings, type PublicSiteSettings } from '../src/lib/site-settings/dto';
import { SITE_SETTINGS_DEFAULTS, type SiteSettingsData } from '../src/lib/site-settings/schema';
import {
  addressLines,
  dayInTimeZone,
  directionsLink,
  mapEmbedUrl,
  mapLink,
  meaningfulText,
  SHOP_TIME_ZONE,
} from '../src/lib/storefront/visit-model';
import { telHref } from '../src/lib/storefront/product-enquiry';
import { buildShellModel } from '../src/lib/storefront/shell-model';


function settings(overrides: Partial<SiteSettingsData> = {}): PublicSiteSettings {
  return toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, ...overrides });
}


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

});

describe('shared visit-model: placeholders hidden everywhere', () => {
  test('addressLines drops placeholder lines', () => {
    assert.deepStrictEqual(addressLines('TBC'), []);
    assert.deepStrictEqual(addressLines(' 12 Fife Avenue \n tbc \n Harare '), ['12 Fife Avenue', 'Harare']);
  });

  test('shell model: a TBC address or holiday note is hidden', () => {
    const m = buildShellModel({ settings: settings({ address: 'TBC', holidayNote: 'TBC' }), categories: [], base: '' });
    assert.deepStrictEqual(m.address, []);
    assert.strictEqual(m.holidayNote, null);
  });
});
