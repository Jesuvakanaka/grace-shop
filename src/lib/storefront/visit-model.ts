// ZP-491: shared, pure helpers for the shop's visit details (shell footer,
// home teaser, Visit us page) and settings pictures. One place, so a
// placeholder address or note ("TBC") is hidden everywhere and the owner's map
// link is checked the same way everywhere. Client-safe: no fetching, no React.
import { isHttpsUrl } from "@/lib/site-settings/validate";
import { DAYS, type Day } from "@/lib/site-settings/schema";
import type { StorefrontImageData } from "@/components/storefront/types";
import { SRCSET_WIDTHS } from "./image-sizes";

/**
 * The shop's time zone for "today". Site settings have no time zone field;
 * the shop is in Zimbabwe (CAT, UTC+2, no daylight saving).
 */
export const SHOP_TIME_ZONE = "Africa/Harare";

// ------------------------------------------------------------------- text

const PLACEHOLDER = /^(tbc|tba|tbd|todo|coming soon|n\/?a|-+|\.+)\.?$/i;

/** Trimmed text, or null when blank or a placeholder such as "TBC". */
export function meaningfulText(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text || PLACEHOLDER.test(text)) return null;
  return text;
}

/** The multi-line address as trimmed lines, blanks dropped. [] when not set. */
export function splitAddress(address: string | null): string[] {
  if (!address) return [];
  return address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Address lines to show: blank and placeholder lines ("TBC") dropped. [] when nothing is left. */
export function addressLines(address: string | null): string[] {
  return splitAddress(address).filter((line) => meaningfulText(line) !== null);
}

// ----------------------------------------------------------------- images

const PUBLIC_PICTURE_URL = /^\/api\/images\/public\/[0-9a-f]{32}\.webp$/;

/** A settings picture URL (/api/images/public/<hex>.webp) as img data with a srcset; null otherwise. */
export function settingsImageData(url: string | null | undefined, alt: string): StorefrontImageData | null {
  if (!url || !PUBLIC_PICTURE_URL.test(url)) return null;
  return { src: url, srcSet: SRCSET_WIDTHS.map((w) => `${url}?w=${w} ${w}w`).join(", "), alt };
}

// ------------------------------------------------------------------- days

function validTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return SHOP_TIME_ZONE;
  }
}

const WEEKDAY_TO_DAY: Record<string, Day> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

/** The weekday of `now` in `timeZone` (an invalid zone falls back to the shop's). */
export function dayInTimeZone(now: Date, timeZone: string = SHOP_TIME_ZONE): Day {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: validTimeZone(timeZone) }).format(now);
  return WEEKDAY_TO_DAY[weekday] ?? DAYS[0];
}

// -------------------------------------------------------------------- map

export type VisitLocation = {
  address: string | null;
  mapUrl: string | null;
  latitude: number | null;
  longitude: number | null;
};

const MAPS_SEARCH = "https://www.google.com/maps/search/?api=1&query=";
const MAPS_DIRECTIONS = "https://www.google.com/maps/dir/?api=1&destination=";

/** The owner's map URL if it is still a valid https:// link (re-checked at render time); else null. */
function ownerMapUrl(v: VisitLocation): string | null {
  return v.mapUrl && isHttpsUrl(v.mapUrl) ? v.mapUrl : null;
}

function addressQuery(address: string | null): string | null {
  const lines = addressLines(address);
  return lines.length > 0 ? lines.join(", ") : null;
}

function coordinateQuery(v: VisitLocation): string | null {
  return v.latitude !== null && v.longitude !== null ? `${v.latitude},${v.longitude}` : null;
}

/** "Open in Google Maps": the owner's map URL, else a search for the address, else the coordinates; null when none. */
export function mapLink(v: VisitLocation): string | null {
  const owner = ownerMapUrl(v);
  if (owner) return owner;
  const query = addressQuery(v.address) ?? coordinateQuery(v);
  return query ? MAPS_SEARCH + encodeURIComponent(query) : null;
}

/** "Get directions": Google Maps directions to the coordinates or address, else the owner's map URL; null when none. */
export function directionsLink(v: VisitLocation): string | null {
  const query = coordinateQuery(v) ?? addressQuery(v.address);
  if (query) return MAPS_DIRECTIONS + encodeURIComponent(query);
  return ownerMapUrl(v);
}

/**
 * Click-to-load embed (no API key): the coordinates, else the address.
 * Null without either; the owner's map URL is never put in an iframe.
 */
export function mapEmbedUrl(v: VisitLocation): string | null {
  const query = coordinateQuery(v) ?? addressQuery(v.address);
  return query ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : null;
}
