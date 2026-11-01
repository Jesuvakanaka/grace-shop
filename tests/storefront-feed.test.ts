/**
 * ZP-500: the flip-feed landing page, pure parts (src/lib/storefront/feed.ts).
 * - Order: featured first, then newest published, sold-out last.
 * - Collection tabs (New in + one per published category with pieces) and tab filtering.
 * - Paging (first 12 server side, load more, "load through" a remembered slide).
 * - The slide DTO (price, tag, enquiry / restock link, links) and the URL state.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  FEED_DETAILS_STORAGE_KEY,
  FEED_MAX_PAGE_SIZE,
  FEED_MAX_THROUGH,
  FEED_NEW_TAB,
  FEED_PAGE_SIZE,
  RESTOCK_TEMPLATE,
  detailsPreferenceValue,
  feedBadge,
  feedLocation,
  feedPage,
  feedProducts,
  feedTabs,
  filterFeed,
  lookAnchorId,
  looksLabel,
  orderFeed,
  parseDetailsPreference,
  parseLookHash,
  photoLinkLabel,
  resolveFeedTab,
  slideIndexAt,
  toFeedItem,
} from '../src/lib/storefront/feed';
import type { PublicCategory, PublicImage, PublicProduct } from '../src/lib/storefront/dto';

const HEX = 'a'.repeat(32);

function image(alt = 'photo'): PublicImage {
  return {
    url: `/api/images/public/${HEX}.webp`,
    srcSet: `/api/images/public/${HEX}.webp?w=320 320w`,
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
    images: [image()],
    isNew: false,
    featured: false,
    priceUsd: null,
    ...overrides,
  };
}

function category(slug: string, name = slug): PublicCategory {
  return { slug, name, description: null, heroImage: null };
}

const contacts = {
  whatsappNumber: '+263 77 123 4567',
  enquiryTemplate: "Hi VYRA, I'm interested in {product} ({url})",
  generalEnquiryMessage: "Hi VYRA, I'd like to ask about your collection.",
};

const slugs = (items: readonly { slug: string }[]) => items.map((p) => p.slug);

describe('orderFeed', () => {
  test('featured first, then the newest-first input order, sold-out last', () => {
    // Input is newest published first (the catalogue's "newest" sort).
    const input = [
      product('newest'),
      product('sold-new', { availability: 'SOLD_OUT' }),
      product('featured-older', { featured: true }),
      product('few-left', { availability: 'FEW_LEFT' }),
      product('sold-featured', { availability: 'SOLD_OUT', featured: true }),
      product('featured-oldest', { featured: true }),
      product('oldest'),
    ];
    assert.deepStrictEqual(slugs(orderFeed(input)), [
      'featured-older',
      'featured-oldest',
      'newest',
      'few-left',
      'oldest',
      'sold-featured',
      'sold-new',
    ]);
  });

  test('feedProducts leaves out pieces without photos, then orders the rest', () => {
    const input = [product('no-photo', { images: [], featured: true }), product('a'), product('b', { featured: true })];
    assert.deepStrictEqual(slugs(feedProducts(input)), ['b', 'a']);
  });

  test('does not change its input and keeps an empty list empty', () => {
    const input = [product('a'), product('b', { featured: true })];
    orderFeed(input);
    assert.deepStrictEqual(slugs(input), ['a', 'b']);
    assert.deepStrictEqual(orderFeed([]), []);
  });
});

describe('feedTabs and filterFeed', () => {
  const ordered = [
    product('d1'),
    product('s1', { category: { slug: 'sets', name: 'Co-ord Sets' } }),
    product('d2'),
  ];
  const categories = [category('occasion', 'Occasion Wear'), category('dresses', 'Dresses'), category('sets', 'Co-ord Sets')];

  test('New in first, then one tab per published category that has pieces, in category order, with counts', () => {
    assert.deepStrictEqual(feedTabs(categories, ordered), [
      { id: FEED_NEW_TAB, label: 'New in', count: 3 },
      { id: 'dresses', label: 'Dresses', count: 2 },
      { id: 'sets', label: 'Co-ord Sets', count: 1 },
    ]);
  });

  test('only New in when nothing is published', () => {
    assert.deepStrictEqual(feedTabs(categories, []), [{ id: FEED_NEW_TAB, label: 'New in', count: 0 }]);
  });

  test('New in is every piece in feed order; a category tab keeps only its pieces', () => {
    assert.deepStrictEqual(slugs(filterFeed(ordered, FEED_NEW_TAB)), ['d1', 's1', 'd2']);
    assert.deepStrictEqual(slugs(filterFeed(ordered, 'dresses')), ['d1', 'd2']);
    assert.deepStrictEqual(slugs(filterFeed(ordered, 'sets')), ['s1']);
    assert.deepStrictEqual(filterFeed(ordered, 'nope'), []);
  });

  test('resolveFeedTab accepts only a known tab id (from ?c=), else New in', () => {
    const tabs = feedTabs(categories, ordered);
    assert.strictEqual(resolveFeedTab('sets', tabs), 'sets');
    assert.strictEqual(resolveFeedTab('occasion', tabs), FEED_NEW_TAB, 'a category without pieces has no tab');
    assert.strictEqual(resolveFeedTab('unknown', tabs), FEED_NEW_TAB);
    assert.strictEqual(resolveFeedTab(['sets', 'dresses'], tabs), 'sets', 'first value of a repeated parameter');
    assert.strictEqual(resolveFeedTab(undefined, tabs), FEED_NEW_TAB);
    assert.strictEqual(resolveFeedTab('', tabs), FEED_NEW_TAB);
    assert.strictEqual(resolveFeedTab(42, tabs), FEED_NEW_TAB);
  });
});

describe('collection sheet and details preference', () => {
  test('looksLabel: "1 look", "N looks"', () => {
    assert.strictEqual(looksLabel(1), '1 look');
    assert.strictEqual(looksLabel(0), '0 looks');
    assert.strictEqual(looksLabel(12), '12 looks');
  });

  test('the stored "show details" choice: only an exact "shown" means shown; clean view otherwise', () => {
    assert.strictEqual(FEED_DETAILS_STORAGE_KEY, 'vyra:feed:details');
    assert.strictEqual(parseDetailsPreference('shown'), true);
    assert.strictEqual(parseDetailsPreference('hidden'), false);
    assert.strictEqual(parseDetailsPreference(null), false);
    assert.strictEqual(parseDetailsPreference(''), false);
    assert.strictEqual(parseDetailsPreference('true'), false);
    assert.strictEqual(parseDetailsPreference(' shown '), false);
    assert.strictEqual(detailsPreferenceValue(true), 'shown');
    assert.strictEqual(detailsPreferenceValue(false), 'hidden');
    assert.strictEqual(parseDetailsPreference(detailsPreferenceValue(true)), true);
  });
});

describe('feedPage', () => {
  const items = Array.from({ length: 30 }, (_, i) => product(`p${i}`));

  test('the first page is FEED_PAGE_SIZE (12) pieces with the next offset', () => {
    assert.strictEqual(FEED_PAGE_SIZE, 12);
    const page = feedPage(items, { offset: 0 });
    assert.deepStrictEqual(slugs(page.items), slugs(items.slice(0, 12)));
    assert.strictEqual(page.nextOffset, 12);
    assert.strictEqual(page.total, 30);
  });

  test('the last page has no next offset', () => {
    const page = feedPage(items, { offset: 24 });
    assert.deepStrictEqual(slugs(page.items), slugs(items.slice(24)));
    assert.strictEqual(page.nextOffset, null);
    assert.deepStrictEqual(feedPage(items, { offset: 30 }).items, []);
    assert.strictEqual(feedPage(items, { offset: 30 }).nextOffset, null);
    assert.strictEqual(feedPage(items, { offset: 12, limit: 18 }).nextOffset, null);
  });

  test('bad offsets and limits are clamped', () => {
    assert.deepStrictEqual(slugs(feedPage(items, { offset: -5 }).items), slugs(items.slice(0, 12)));
    assert.deepStrictEqual(slugs(feedPage(items, { offset: Number.NaN }).items), slugs(items.slice(0, 12)));
    assert.deepStrictEqual(slugs(feedPage(items, { offset: 2.7, limit: 2.9 }).items), ['p2', 'p3']);
    assert.strictEqual(feedPage(items, { offset: 0, limit: 0 }).items.length, 1);
    assert.strictEqual(feedPage(items, { offset: 0, limit: 10_000 }).items.length, Math.min(30, FEED_MAX_PAGE_SIZE));
    assert.strictEqual(feedPage(items, { offset: 1e9 }).items.length, 0);
  });

  test('"through" a slug loads every page up to and including the one that holds it', () => {
    const page = feedPage(items, { offset: 0, through: 'p13' });
    assert.deepStrictEqual(slugs(page.items), slugs(items.slice(0, 24)));
    assert.strictEqual(page.nextOffset, 24);
    // A slug on the first page or an unknown slug changes nothing.
    assert.strictEqual(feedPage(items, { offset: 0, through: 'p3' }).items.length, 12);
    assert.strictEqual(feedPage(items, { offset: 0, through: 'missing' }).items.length, 12);
  });

  test('"through" never loads more than FEED_MAX_THROUGH pieces in one go', () => {
    assert.strictEqual(FEED_MAX_THROUGH, 96);
    const many = Array.from({ length: 300 }, (_, i) => product(`m${i}`));
    const far = feedPage(many, { offset: 0, through: 'm250' });
    assert.strictEqual(far.items.length, FEED_MAX_THROUGH);
    assert.strictEqual(far.nextOffset, FEED_MAX_THROUGH);
    // Within the cap it still rounds up to whole pages.
    assert.strictEqual(feedPage(many, { offset: 12, through: 'm40' }).items.length, 36);
    assert.strictEqual(feedPage(many, { offset: 12, through: 'm150' }).items.length, FEED_MAX_THROUGH);
  });
});

describe('slideIndexAt', () => {
  test('the slide under the scroll position, clamped to the slides that exist', () => {
    assert.strictEqual(slideIndexAt(0, 800, 5), 0);
    assert.strictEqual(slideIndexAt(1600, 800, 5), 2);
    assert.strictEqual(slideIndexAt(1990, 800, 5), 2, 'rounds to the nearest slide');
    assert.strictEqual(slideIndexAt(2010, 800, 5), 3);
    assert.strictEqual(slideIndexAt(99_999, 800, 5), 4);
    assert.strictEqual(slideIndexAt(-50, 800, 5), 0);
    assert.strictEqual(slideIndexAt(500, 0, 5), 0, 'no height yet');
    assert.strictEqual(slideIndexAt(500, 800, 0), 0);
  });
});

describe('toFeedItem', () => {
  const ctx = {
    base: '/site' as const,
    contacts,
    productUrl: (slug: string) => `https://vyra.example/p/${slug}`,
  };

  test('builds the slide from public fields only, with real product links', () => {
    const item = toFeedItem(
      product('lime-midi', {
        name: 'Lime Pleated Midi Dress',
        priceUsd: 65,
        images: [image('front'), image('back')],
        category: { slug: 'dresses', name: 'Dresses' },
      }),
      ctx,
    );
    assert.deepStrictEqual(Object.keys(item).sort(), [
      'badge',
      'category',
      'enquireHref',
      'href',
      'images',
      'loves', // ZP-507
      'name',
      'price',
      'shareUrl',
      'slug',
      'soldOut',
      'video',
    ]);
    assert.strictEqual(item.href, '/site/p/lime-midi');
    assert.strictEqual(item.price, '$65');
    assert.strictEqual(item.category, 'Dresses');
    assert.strictEqual(item.soldOut, false);
    assert.strictEqual(item.shareUrl, 'https://vyra.example/p/lime-midi');
    assert.deepStrictEqual(item.images.map((i) => i.alt), ['front', 'back']);
    assert.deepStrictEqual(Object.keys(item.images[0]).sort(), ['alt', 'src', 'srcSet']);
    const text = new URL(item.enquireHref as string).searchParams.get('text');
    assert.strictEqual(text, "Hi VYRA, I'm interested in Lime Pleated Midi Dress (https://vyra.example/p/lime-midi)");
    assert.strictEqual(toFeedItem(product('x'), { ...ctx, base: '' }).href, '/p/x');
  });

  test('"Ask for price" when there is no public price', () => {
    assert.strictEqual(toFeedItem(product('x', { priceUsd: null }), ctx).price, 'Ask for price');
    assert.strictEqual(toFeedItem(product('x', { priceUsd: 45.5 }), ctx).price, '$45.50');
  });

  test('sold-out pieces enquire with the restock message (still through buildWhatsAppLink)', () => {
    const item = toFeedItem(product('bronze', { name: 'Bronze Set', availability: 'SOLD_OUT' }), ctx);
    assert.strictEqual(item.soldOut, true);
    const url = new URL(item.enquireHref as string);
    assert.strictEqual(url.origin + url.pathname, 'https://wa.me/263771234567');
    assert.strictEqual(
      url.searchParams.get('text'),
      RESTOCK_TEMPLATE.replace('{product}', 'Bronze Set').replace('{url}', 'https://vyra.example/p/bronze'),
    );
    assert.match(url.searchParams.get('text') as string, /back in stock/);
  });

  test('no WhatsApp number: no enquiry link; no absolute URL: no share URL, message without it', () => {
    const none = toFeedItem(product('x'), { ...ctx, contacts: { ...contacts, whatsappNumber: null } });
    assert.strictEqual(none.enquireHref, null);
    const noUrl = toFeedItem(product('x', { name: 'X' }), { ...ctx, productUrl: () => null });
    assert.strictEqual(noUrl.shareUrl, null);
    assert.strictEqual(new URL(noUrl.enquireHref as string).searchParams.get('text'), "Hi VYRA, I'm interested in X");
  });

  test('photoLinkLabel names the look, price and tag for the clean-view photo link', () => {
    const base = toFeedItem(product('x', { name: 'Lime Midi', priceUsd: 65 }), ctx);
    assert.strictEqual(photoLinkLabel(base), 'Lime Midi, $65. View details');
    const sold = toFeedItem(product('y', { name: 'Bronze Set', availability: 'SOLD_OUT' }), ctx);
    assert.strictEqual(photoLinkLabel(sold), 'Bronze Set, Ask for price, Sold out. View details');
    const fresh = toFeedItem(product('z', { name: 'Fringe Set', isNew: true, priceUsd: 60 }), ctx);
    assert.strictEqual(photoLinkLabel(fresh), 'Fringe Set, $60, New. View details');
  });

  test('tag: Sold out, else Few left, else New, else none', () => {
    assert.deepStrictEqual(feedBadge(product('x', { availability: 'SOLD_OUT', isNew: true })), { kind: 'sold-out', label: 'Sold out' });
    assert.deepStrictEqual(feedBadge(product('x', { availability: 'FEW_LEFT', isNew: true })), { kind: 'few-left', label: 'Few left' });
    assert.deepStrictEqual(feedBadge(product('x', { isNew: true })), { kind: 'new', label: 'New' });
    assert.strictEqual(feedBadge(product('x')), null);
  });
});

describe('feed URL state (tab in ?c=, slide in the hash)', () => {
  test('lookAnchorId / parseLookHash round-trip, rejecting anything that is not a slug', () => {
    assert.strictEqual(lookAnchorId('lime-midi'), 'look-lime-midi');
    assert.strictEqual(parseLookHash('#look-lime-midi'), 'lime-midi');
    assert.strictEqual(parseLookHash('look-lime-midi'), 'lime-midi');
    assert.strictEqual(parseLookHash('#main'), null);
    assert.strictEqual(parseLookHash('#look-'), null);
    assert.strictEqual(parseLookHash('#look-<script>'), null);
    assert.strictEqual(parseLookHash(''), null);
  });

  test('feedLocation keeps other query parameters, sets or clears c and the look hash', () => {
    assert.strictEqual(feedLocation('/site', '', FEED_NEW_TAB, null), '/site');
    assert.strictEqual(feedLocation('/site', '', 'dresses', null), '/site?c=dresses');
    assert.strictEqual(feedLocation('/site', '?c=sets', FEED_NEW_TAB, 'x'), '/site#look-x');
    assert.strictEqual(feedLocation('/', '?utm=a&c=sets', 'dresses', 'lime'), '/?utm=a&c=dresses#look-lime');
  });
});
