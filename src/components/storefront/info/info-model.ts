// ZP-491: what the About and Visit us pages show, built from the public site
// settings. Pure: no fetching, no React. Tested in
// tests/storefront-about-visit.test.ts. Every block is null/empty when its
// value is missing, so the pages never render an empty block or "TBC".
//
// Shared visit helpers (time zone, map links, placeholders, settings
// pictures) live in src/lib/storefront/visit-model.ts, also used by the home
// page and the shell footer.
import { buildWhatsAppLink } from "@/lib/site-settings/whatsapp";
import type { PublicSiteSettings } from "@/lib/site-settings/dto";
import { DAYS, DAY_LABELS, type Day, type OpeningHours } from "@/lib/site-settings/schema";
import { SITE_ROUTES, sitePath, type SiteBase } from "@/lib/storefront/paths";
import { buildShellModel, VYRA_TAGLINE } from "@/lib/storefront/shell-model";
import {
  addressLines,
  dayInTimeZone,
  directionsLink,
  mapEmbedUrl,
  mapLink,
  meaningfulText,
  settingsImageData,
  SHOP_TIME_ZONE,
} from "@/lib/storefront/visit-model";
import { lookbookImage, type LookbookStem } from "../lookbook";
import type { SocialLink, StorefrontImageData } from "../types";

export {
  dayInTimeZone,
  directionsLink,
  mapEmbedUrl,
  mapLink,
  meaningfulText,
  settingsImageData,
  SHOP_TIME_ZONE,
} from "@/lib/storefront/visit-model";

/** About headline when the owner has not set one (the brand board's campaign line). */
export const DEFAULT_ABOUT_HEADLINE = "Be bold. Be you.";
/** "What WEAR DIFFERENT. means". Site settings have no field for it yet. */
export const DEFAULT_MEANING =
  "It means dressing for the person you are, not the one you are told to be. Choose the piece that feels like you, wear it your way, and walk in knowing you belong.";
/** About photo when no settings picture is set: the one with the VYRA sign. */
export const ABOUT_FALLBACK_STEM: LookbookStem = "olive-print-pleated-dress";
/** Visit us side photo. */
export const VISIT_IMAGE_STEM: LookbookStem = "olive-print-jumpsuit";

const ABOUT_SETTINGS_ALT = "VYRA campaign photo";

// ------------------------------------------------------------------- text

/** Story paragraphs split on blank lines (single line breaks stay); placeholders dropped. */
export function storyParagraphs(story: string | null | undefined): string[] {
  if (!story) return [];
  return story
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => meaningfulText(p))
    .filter((p): p is string => p !== null);
}

/** tel: link with digits and a leading plus only; null when there are no digits. */
export function telHref(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim() ?? "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

// ------------------------------------------------------------------ hours

export type DayRow = { day: Day; label: string; text: string; closed: boolean; isToday: boolean };

/** Monday to Sunday, today (in the shop's time zone) marked; null when no hours are set. */
export function weekHours(hours: OpeningHours | null, now: Date, timeZone: string = SHOP_TIME_ZONE): DayRow[] | null {
  if (!hours) return null;
  const today = dayInTimeZone(now, timeZone);
  return DAYS.map((day) => {
    const h = hours[day];
    const closed = !h || h.closed;
    return {
      day,
      label: DAY_LABELS[day],
      text: !h || h.closed ? "Closed" : `${h.open}–${h.close}`,
      closed,
      isToday: day === today,
    };
  });
}

// ------------------------------------------------------------------ about

export type AboutModel = {
  headline: string;
  /** Paragraphs, or null (hide the story). */
  story: string[] | null;
  image: { image: StorefrontImageData; source: "settings" | "lookbook" };
  meaning: { title: string; text: string };
  shopHref: string;
};

export function buildAboutModel(input: { settings: PublicSiteSettings; base: SiteBase }): AboutModel {
  const { about } = input.settings;
  const story = storyParagraphs(about.story);
  const settingsImage = settingsImageData(about.imageUrl, ABOUT_SETTINGS_ALT);
  return {
    headline: meaningfulText(about.headline) ?? DEFAULT_ABOUT_HEADLINE,
    story: story.length > 0 ? story : null,
    image: settingsImage
      ? { image: settingsImage, source: "settings" }
      : { image: lookbookImage(ABOUT_FALLBACK_STEM), source: "lookbook" },
    meaning: { title: `What ${VYRA_TAGLINE} means`, text: DEFAULT_MEANING },
    shopHref: sitePath(input.base, SITE_ROUTES.shop),
  };
}

// ------------------------------------------------------------------ visit

export type VisitModel = {
  /** Address lines (placeholders dropped); [] hides the block. */
  address: string[];
  /** The week with today marked; null hides the block. */
  hours: DayRow[] | null;
  holidayNote: string | null;
  phone: { display: string; href: string } | null;
  email: { display: string; href: string } | null;
  /** General-enquiry wa.me link; null hides the WhatsApp button. */
  whatsappHref: string | null;
  /** Null when there is no valid map URL, address or coordinates. */
  map: { openHref: string; directionsHref: string; embedSrc: string | null } | null;
  social: SocialLink[];
  image: StorefrontImageData;
  /** False when nothing at all is set (the page shows only its heading, photo and a shop link). */
  hasDetails: boolean;
};

export function buildVisitModel(input: { settings: PublicSiteSettings; now: Date; timeZone?: string }): VisitModel {
  const { settings, now } = input;
  const { visit, contacts } = settings;

  const address = addressLines(visit.address);
  const hours = weekHours(visit.hours, now, input.timeZone ?? SHOP_TIME_ZONE);
  const holidayNote = meaningfulText(visit.holidayNote);
  const phoneText = meaningfulText(contacts.phone);
  const phoneHref = telHref(phoneText);
  const phone = phoneText && phoneHref ? { display: phoneText, href: phoneHref } : null;
  const emailText = meaningfulText(contacts.email);
  const email = emailText ? { display: emailText, href: `mailto:${emailText}` } : null;
  const whatsappHref = buildWhatsAppLink(settings);

  const openHref = mapLink(visit);
  const directionsHref = directionsLink(visit);
  const map = openHref && directionsHref ? { openHref, directionsHref, embedSrc: mapEmbedUrl(visit) } : null;

  // Same social list (labels, order) as the header and footer.
  const social = buildShellModel({ settings, categories: [], base: "" }).social;

  const hasDetails = Boolean(
    address.length || hours || holidayNote || phone || email || whatsappHref || map || social.length,
  );

  return {
    address,
    hours,
    holidayNote,
    phone,
    email,
    whatsappHref,
    map,
    social,
    image: lookbookImage(VISIT_IMAGE_STEM),
    hasDetails,
  };
}
