// ZP-488: what the VYRA home page shows, built from data that is passed in.
// Pure: no fetching (see ./home-data.ts), no React. Tested in
// tests/storefront-home.test.ts. Every block is null when its data is
// missing, so the page never renders an empty section.
import { buildWhatsAppLink } from "@/lib/site-settings/whatsapp";
import type { PublicSiteSettings } from "@/lib/site-settings/dto";
import { DAY_LABELS, type Day, type OpeningHours } from "@/lib/site-settings/schema";
import { SITE_ROUTES, sitePath, type SiteBase } from "@/lib/storefront/paths";
import { VYRA_TAGLINE } from "@/lib/storefront/shell-model";
import {
  addressLines,
  dayInTimeZone,
  mapLink,
  meaningfulText,
  settingsImageData,
  SHOP_TIME_ZONE,
} from "@/lib/storefront/visit-model";
import type { PublicCategory, PublicImage, PublicProduct } from "@/lib/storefront/dto";
import { lookbookImage, type LookbookStem } from "../lookbook";
import { toImageData } from "../product";
import type { StorefrontImageData } from "../types";

// Shared with the shell footer and Visit us (ZP-491): time zone, settings
// pictures, map link, placeholder handling.
export { dayInTimeZone, mapLink, settingsImageData, SHOP_TIME_ZONE } from "@/lib/storefront/visit-model";

export const DEFAULT_HERO_HEADLINE = "Style Your Way";
export const DEFAULT_HERO_SUBLINE = "Premium fashion. Modern you.";
/** Brand band italic line. Site settings have no field for it yet. */
export const BRAND_BAND_LINE = "Fashion that fits your vibe.";
export const DEFAULT_STATEMENT = "Confidence in every stitch";

export const NEW_ARRIVALS_LIMIT = 8;
export const FEATURED_LIMIT = 4;

/** The hero photo when the owner has not uploaded one in Site settings. */
export const HERO_FALLBACK_STEM: LookbookStem = "lime-pleated-dress";
/** The brand band photo. */
export const BRAND_BAND_STEM: LookbookStem = "olive-print-pleated-dress";
/** The large photo of the featured edit. */
export const FEATURED_EDIT_STEM: LookbookStem = "olive-print-jumpsuit";
/**
 * Collection tiles without a hero image or product photo rotate through
 * these. The hero photo comes last so it is not repeated right under the hero.
 */
export const TILE_FALLBACK_STEMS: readonly LookbookStem[] = [
  "chartreuse-fringe-knit-set",
  "bronze-pleated-set",
  "olive-print-jumpsuit",
  "olive-print-pleated-dress",
  "lime-pleated-dress",
];

const HERO_SETTINGS_ALT = "VYRA campaign photo";

// ---------------------------------------------------------------- headline

export type Headline = { lead: string; accent: string | null };

/** "Style Your Way" -> lead "Style Your", accent "Way" (set in italic where contrast allows). */
export function splitHeadline(text: string): Headline {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return splitHeadline(DEFAULT_HERO_HEADLINE);
  if (words.length === 1) return { lead: words[0], accent: null };
  return { lead: words.slice(0, -1).join(" "), accent: words[words.length - 1] };
}

// ------------------------------------------------------------------ images

export type HeroImages = {
  /** The base image (phones, and desktop when `desktop` is null). */
  image: StorefrontImageData;
  /** A different picture for md and up (art direction), or null. */
  desktop: StorefrontImageData | null;
  source: "settings" | "lookbook";
};

/** Site settings hero pictures if set (each stands in for the other), else the lookbook hero photo. */
export function heroImages(urls: { desktop: string | null; mobile: string | null }): HeroImages {
  const desktop = settingsImageData(urls.desktop, HERO_SETTINGS_ALT);
  const mobile = settingsImageData(urls.mobile, HERO_SETTINGS_ALT);
  if (!desktop && !mobile) return { image: lookbookImage(HERO_FALLBACK_STEM), desktop: null, source: "lookbook" };
  const base = (mobile ?? desktop) as StorefrontImageData;
  const art = desktop && mobile && desktop.src !== mobile.src ? desktop : null;
  return { image: base, desktop: art, source: "settings" };
}

// ----------------------------------------------------------- today's hours

export type TodaysHours = { day: Day; dayLabel: string; open: boolean; text: string };

/** Today's opening hours in the shop's time zone; null when no hours are set. */
export function todaysHours(hours: OpeningHours | null, now: Date, timeZone: string = SHOP_TIME_ZONE): TodaysHours | null {
  if (!hours) return null;
  const day = dayInTimeZone(now, timeZone);
  const h = hours[day];
  if (!h) return null;
  return h.closed
    ? { day, dayLabel: DAY_LABELS[day], open: false, text: "Closed" }
    : { day, dayLabel: DAY_LABELS[day], open: true, text: `${h.open}–${h.close}` };
}

// ------------------------------------------------------------ collections

export type CategoryTileData = {
  slug: string;
  name: string;
  image: StorefrontImageData;
  source: "hero" | "product" | "lookbook";
};

/**
 * One tile per category. Photo: the category hero image, else the first
 * photo of the category's first product (`covers`, by category slug), else a
 * lookbook photo, rotating through TILE_FALLBACK_STEMS so neighbouring
 * fallback tiles differ. Images are decorative (the tile link names them).
 */
export function categoryTiles(
  categories: readonly PublicCategory[],
  covers: Readonly<Record<string, PublicImage | undefined>>,
): CategoryTileData[] {
  let fallback = 0;
  return categories.map((c) => {
    const base = { slug: c.slug, name: c.name };
    if (c.heroImage) return { ...base, image: { ...toImageData(c.heroImage), alt: "" }, source: "hero" };
    const cover = covers[c.slug];
    if (cover) return { ...base, image: { ...toImageData(cover), alt: "" }, source: "product" };
    const stem = TILE_FALLBACK_STEMS[fallback++ % TILE_FALLBACK_STEMS.length];
    return { ...base, image: lookbookImage(stem, { alt: "" }), source: "lookbook" };
  });
}

/**
 * Desktop columns for the collection tiles: 2 for one or two tiles, else 3
 * or 4, whichever leaves fewer empty cells in the last row (4 on a tie).
 */
export function collectionColumns(count: number): 2 | 3 | 4 {
  if (count <= 2) return 2;
  const gaps = (cols: number) => (cols - (count % cols)) % cols;
  return gaps(3) < gaps(4) ? 3 : 4;
}

// ------------------------------------------------------------------ model

export type HomeModel = {
  hero: { headline: Headline; subline: string; image: HeroImages };
  trustLabels: [string, string, string];
  /** Up to NEW_ARRIVALS_LIMIT new arrivals, or null (hide). */
  newArrivals: PublicProduct[] | null;
  /** One tile per published category, or null (hide). */
  collections: (CategoryTileData & { href: string })[] | null;
  brandBand: { tagline: string; line: string; image: StorefrontImageData };
  /** The olive colour-block statement. */
  statement: string;
  /** Up to FEATURED_LIMIT featured products in admin order, with the edit photo; or null (hide). */
  featured: { products: PublicProduct[]; image: StorefrontImageData } | null;
  /** Visit-us teaser; null when there is no address, no hours and no WhatsApp. */
  visit: {
    address: string[];
    today: TodaysHours | null;
    holidayNote: string | null;
    mapHref: string | null;
    whatsappHref: string | null;
  } | null;
  links: { shop: string; newArrivals: string; collections: string; about: string; visit: string };
  productHref: (slug: string) => string;
};

export function buildHomeModel(input: {
  settings: PublicSiteSettings;
  /** New arrivals, newest first (from the cached catalogue). */
  newArrivals: readonly PublicProduct[];
  /** Featured products in admin order (from the cached catalogue). */
  featured: readonly PublicProduct[];
  categories: readonly PublicCategory[];
  /** First product photo per category slug, for tiles without a hero image. */
  categoryCovers: Readonly<Record<string, PublicImage | undefined>>;
  base: SiteBase;
  now: Date;
  timeZone?: string;
}): HomeModel {
  const { settings, base, now } = input;
  const to = (path: string) => sitePath(base, path);

  const newArrivals = input.newArrivals.filter((p) => p.isNew).slice(0, NEW_ARRIVALS_LIMIT);
  const featured = input.featured.filter((p) => p.featured).slice(0, FEATURED_LIMIT);
  const tiles = categoryTiles(input.categories, input.categoryCovers).map((t) => ({
    ...t,
    href: to(SITE_ROUTES.collection(t.slug)),
  }));

  const address = addressLines(settings.visit.address);
  const today = todaysHours(settings.visit.hours, now, input.timeZone ?? SHOP_TIME_ZONE);
  const whatsappHref = buildWhatsAppLink(settings);
  const hasVisit = address.length > 0 || today !== null || whatsappHref !== null;

  return {
    hero: {
      headline: splitHeadline(settings.home.heroHeadline || DEFAULT_HERO_HEADLINE),
      subline: settings.home.heroSubline.trim() || DEFAULT_HERO_SUBLINE,
      image: heroImages(settings.home.heroImageUrls),
    },
    trustLabels: settings.home.trustLabels,
    newArrivals: newArrivals.length > 0 ? newArrivals : null,
    collections: tiles.length > 0 ? tiles : null,
    brandBand: { tagline: VYRA_TAGLINE, line: BRAND_BAND_LINE, image: lookbookImage(BRAND_BAND_STEM) },
    statement: settings.home.statement.trim() || DEFAULT_STATEMENT,
    featured: featured.length > 0 ? { products: featured, image: lookbookImage(FEATURED_EDIT_STEM) } : null,
    visit: hasVisit
      ? {
          address,
          today,
          holidayNote: meaningfulText(settings.visit.holidayNote),
          mapHref: mapLink(settings.visit),
          whatsappHref,
        }
      : null,
    links: {
      shop: to(SITE_ROUTES.shop),
      newArrivals: to(SITE_ROUTES.newArrivals),
      collections: to(SITE_ROUTES.collections),
      about: to(SITE_ROUTES.about),
      visit: to(SITE_ROUTES.visit),
    },
    productHref: (slug: string) => to(SITE_ROUTES.product(slug)),
  };
}
