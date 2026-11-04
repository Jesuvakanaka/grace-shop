/**
 * ZP-515: how a feed photo fills its frame (src/lib/storefront/photo-fit.ts).
 * - Portrait photos stay full-screen (cover) on phones and the 9:16 column.
 * - A landscape photo on a phone, or a photo narrower than the frame that
 *   would lose its head or feet, is shown whole (contain).
 * - Unknown sizes stay cover.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { photoFit } from '../src/lib/storefront/photo-fit';

const PHONE = { width: 360, height: 800 };
const IPHONE = { width: 375, height: 812 };
const COLUMN = { width: 558, height: 992 };
const LANDSCAPE_PHONE = { width: 812, height: 375 };

const photo = (width: number, height: number) => ({ width, height });

describe('photoFit', () => {
  test('the usual 2:3 and 4:5 portrait photos fill phones and the column', () => {
    for (const frame of [PHONE, IPHONE, COLUMN]) {
      assert.strictEqual(photoFit(photo(1024, 1536), frame), 'cover');
      assert.strictEqual(photoFit(photo(1080, 1350), frame), 'cover');
    }
  });

  test('a 3:2 landscape photo is shown whole on phones (cover would keep a third of it)', () => {
    assert.strictEqual(photoFit(photo(1536, 1024), PHONE), 'contain');
    assert.strictEqual(photoFit(photo(1536, 1024), IPHONE), 'contain');
    assert.strictEqual(photoFit(photo(1536, 1024), COLUMN), 'contain');
  });

  test('a photo narrower than the column is shown whole there (head and feet), but fills a phone', () => {
    assert.strictEqual(photoFit(photo(480, 1018), COLUMN), 'contain');
    assert.strictEqual(photoFit(photo(480, 943), COLUMN), 'contain');
    assert.strictEqual(photoFit(photo(480, 1018), IPHONE), 'cover');
  });

  test('a photo almost the shape of the frame stays cover', () => {
    assert.strictEqual(photoFit(photo(480, 852), COLUMN), 'cover');
    assert.strictEqual(photoFit(photo(540, 1000), COLUMN), 'cover');
  });

  test('a phone turned sideways shows portrait photos whole', () => {
    assert.strictEqual(photoFit(photo(1024, 1536), LANDSCAPE_PHONE), 'contain');
  });

  test('unknown or broken sizes stay cover', () => {
    assert.strictEqual(photoFit(photo(0, 0), PHONE), 'cover');
    assert.strictEqual(photoFit(photo(1536, 1024), { width: 0, height: 800 }), 'cover');
    assert.strictEqual(photoFit(photo(Number.NaN, 1024), PHONE), 'cover');
  });
});
