// ZP-481 design preview only: placeholder "photography" drawn as SVG and
// served by ./art/[key]/route.ts, so the preview needs no external image host
// and never shows the private August packing shots. Each photo is a real,
// separately cached request, so lazy loading and fade-in behave as they will
// with real photos. Garments sit in a cream stone niche,
// echoing the brand board (lime, cream and black pieces, woven labels).

import type { StorefrontImageData } from "@/components/storefront/types";

const C = {
  cream: "#EDE6D3",
  creamLight: "#F6F2E8",
  stone: "#DED4BA",
  stoneDark: "#C9BC9A",
  lime: "#9BB21E",
  limeLight: "#C5D651",
  limePale: "#DDE88F",
  olive: "#5F7A1F",
  oliveDark: "#4A6018",
  oliveDeep: "#2A3610",
  ink: "#1E1E1E",
  white: "#FFFFFF",
};

export type Garment = "dress" | "blazer" | "trousers" | "top" | "knit" | "tote" | "label" | "rail" | "set";

export type ArtTone = {
  /** Background top and bottom. */
  bg: [string, string];
  /** Niche (arch) colour behind the garment. */
  niche: string;
  /** Garment colour. */
  fill: string;
  /** Line / detail colour on the garment. */
  detail?: string;
};

export const tones = {
  limeOnCream: { bg: [C.creamLight, C.cream], niche: C.stone, fill: C.lime, detail: C.oliveDark },
  creamOnOlive: { bg: [C.olive, C.oliveDark], niche: "#6C8A22", fill: C.creamLight, detail: C.stoneDark },
  inkOnLime: { bg: [C.limePale, C.limeLight], niche: "#D2DF7A", fill: C.ink, detail: "#3A3A3A" },
  oliveOnCream: { bg: [C.cream, C.stone], niche: C.creamLight, fill: C.olive, detail: C.oliveDeep },
  creamOnStone: { bg: [C.stone, C.stoneDark], niche: C.cream, fill: C.white, detail: C.stoneDark },
  inkOnCream: { bg: [C.creamLight, C.cream], niche: C.stone, fill: C.ink, detail: "#444" },
  limeOnInk: { bg: ["#2B2925", C.ink], niche: "#33312C", fill: C.lime, detail: C.oliveDark },
} satisfies Record<string, ArtTone>;

export type ToneName = keyof typeof tones;
const GARMENTS: readonly Garment[] = ["dress", "blazer", "trousers", "top", "knit", "tote", "label", "rail", "set"];

/** URL prefix of the art route. */
export const ART_BASE = "/site/preview/art";

const HANGER = `<g fill="none" stroke="${C.ink}" stroke-linecap="round"><path d="M200 100v-12a12 12 0 1 1 12-12" stroke-width="3.5"/><path d="M126 132 200 100l74 32" stroke-width="5"/></g>`;

// Tiny VYRA mark (mono) for woven labels on bags and tags.
const miniMark = (x: number, y: number, s: number, fill: string) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}"><path d="M64 80H172L248 219.4 194 318.4Z"/><path d="M448 80H340L202 333 256 432Z"/></g>`;

function shade(path: string) {
  return `<path d="${path}" fill="${C.ink}" opacity=".1"/>`;
}

function garment(kind: Garment, t: ArtTone): string {
  const f = t.fill;
  const d = t.detail ?? C.ink;
  switch (kind) {
    case "dress":
      return `${HANGER}<path d="M176 126 166 104M224 126l10-22" stroke="${f}" stroke-width="5"/>
<path d="M172 124q28 12 56 0l10 62q6 14-2 28l66 222q-102 18-204 0l66-222q-8-14-2-28z" fill="${f}"/>
${shade("M200 132q16-2 28-8l10 62q6 14-2 28l66 222q-50 9-102 9z")}
<path d="M164 212q36 12 72 0" fill="none" stroke="${d}" stroke-width="4"/>
<path d="M186 230 160 430M214 230l26 200" stroke="${d}" stroke-width="1.5" opacity=".35" fill="none"/>`;
    case "blazer":
      return `${HANGER}<path d="M146 128 200 118l54 10 38 24 20 222-28 4-10-140-2 168H128l-2-168-10 140-28-4 20-222z" fill="${f}"/>
${shade("M200 118l54 10 38 24 20 222-28 4-10-140-2 168h-72z")}
<path d="M180 124 156 170l34 26 10 34z" fill="${d}" opacity=".55"/><path d="M220 124l24 46-34 26-10 34z" fill="${d}" opacity=".4"/>
<path d="M200 230v174" stroke="${d}" stroke-width="1.5" opacity=".5"/><circle cx="210" cy="274" r="4" fill="${d}"/><circle cx="210" cy="312" r="4" fill="${d}"/>
<path d="M142 330h36M222 330h36" stroke="${d}" stroke-width="2" opacity=".6"/>`;
    case "trousers":
      return `${HANGER}<path d="M140 128h120l18 320h-68l-10-226-10 226h-68z" fill="${f}"/>
${shade("M200 128h60l18 320h-68z")}<path d="M140 128h120v18H140z" fill="${d}" opacity=".5"/>
<path d="M166 150l-12 296M234 150l12 296" stroke="${d}" stroke-width="1.5" opacity=".4"/>`;
    case "top":
      return `${HANGER}<path d="M150 128 200 122l50 6 52 34-18 56-22-14v144H138V204l-22 14-18-56z" fill="${f}"/>
${shade("M200 122l50 6 52 34-18 56-22-14v144h-62z")}<path d="M180 124q20 26 40 0" fill="none" stroke="${d}" stroke-width="3"/>
<path d="M138 330h124" stroke="${d}" stroke-width="2" opacity=".4"/>`;
    case "knit":
      return `${HANGER}<path d="M148 130 200 124l52 6 48 26 16 206-24 4-18-150-2 140H128l-2-140-18 150-24-4 16-206z" fill="${f}"/>
${shade("M200 124l52 6 48 26 16 206-24 4-18-150-2 140h-72z")}
<g stroke="${d}" stroke-width="2" opacity=".45"><path d="M128 336h144M128 344h144M88 352l22 3M290 355l22-3"/><path d="M182 128q18 18 36 0"/></g>
<g stroke="${d}" stroke-width="1" opacity=".25">${[150, 170, 190, 210, 230, 250].map((x) => `<path d="M${x} 150v180"/>`).join("")}</g>`;
    case "tote":
      return `<path d="M152 236v-34q0-48 48-48t48 48v34" fill="none" stroke="${d}" stroke-width="9" stroke-linecap="round"/>
<path d="M108 232h184l14 214H94z" fill="${f}"/>${shade("M200 232h92l14 214H200z")}<path d="M108 232h184v12H108z" fill="${d}" opacity=".35"/>
<rect x="178" y="300" width="44" height="28" fill="${C.ink}"/><rect x="181" y="303" width="38" height="22" fill="none" stroke="${C.stoneDark}" stroke-width=".8" stroke-dasharray="2 2"/>${miniMark(187, 305, 0.05, C.lime)}`;
    case "label":
      return `<g transform="rotate(-8 200 260)"><rect x="96" y="196" width="208" height="128" fill="${C.ink}"/><rect x="104" y="204" width="192" height="112" fill="none" stroke="#55514A" stroke-width="1.5" stroke-dasharray="3 3"/>
<path d="M96 196l-14 10v108l14 10zM304 196l14 10v108l-14 10z" fill="#111"/>${miniMark(164, 214, 0.15, C.lime)}</g>
<path d="M60 380q140 40 280 0" stroke="${C.stoneDark}" stroke-width="2" fill="none" opacity=".6"/>`;
    case "rail": {
      const pieces = [C.lime, C.creamLight, C.ink, C.lime, C.olive, C.creamLight];
      return `<path d="M40 116h320M52 116v350M348 116v350M36 466h40M324 466h40" stroke="${C.ink}" stroke-width="5" stroke-linecap="round" fill="none"/>
${pieces
  .map((col, i) => {
    const x = 78 + i * 49;
    const len = i % 2 ? 210 : 260;
    return `<g><path d="M${x} 116v12" stroke="${C.ink}" stroke-width="2"/><path d="M${x - 22} 140l22-12 22 12 6 ${len}h-56z" fill="${col}"/><path d="M${x} 128l22 12 6 ${len}h-28z" fill="${C.ink}" opacity=".1"/></g>`;
  })
  .join("")}`;
    }
    case "set":
      return `${garment("top", t)}<path d="M150 344h100l14 104h-48l-16-70-16 70h-48z" fill="${f}"/>${shade("M200 344h50l14 104h-48z")}`;
  }
}

function svgDoc(w: number, h: number, body: string, viewBox = `0 0 ${w} ${h}`): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}


function productSvg(kind: Garment, tone: ArtTone, detail: boolean): string {
  const id = `g${kind}`;
  const body = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone.bg[0]}"/><stop offset="1" stop-color="${tone.bg[1]}"/></linearGradient>
<radialGradient id="${id}l" cx=".75" cy=".1" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="400" height="500" fill="url(#${id})"/>
<path d="M78 500V196a122 122 0 0 1 244 0v304z" fill="${tone.niche}"/>
<rect y="458" width="400" height="42" fill="${C.ink}" opacity=".05"/>
<ellipse cx="200" cy="462" rx="118" ry="9" fill="${C.ink}" opacity=".12"/>
${garment(kind, tone)}<rect width="400" height="500" fill="url(#${id}l)"/>`;
  return svgDoc(800, 1000, body, detail ? "90 110 220 275" : "0 0 400 500");
}

/** A 4:5 product "photo": a garment in a stone niche. `detail` crops in for the hover shot. */
export function productArt(kind: Garment, tone: ToneName, alt: string, opts: { detail?: boolean } = {}): StorefrontImageData {
  return { src: `${ART_BASE}/${kind}.${tone}${opts.detail ? ".detail" : ""}.svg`, alt, width: 800, height: 1000 };
}

/** Hero scene: greenery on the left, cream stone on the right, a figure in head-to-toe lime. */
function heroScene(): string {
  const leaves: string[] = [];
  const greens = [C.oliveDeep, "#3A4B14", C.oliveDark, C.olive, "#6C8A22"];
  // Deterministic "foliage": overlapping circles and leaf ellipses, darkest at the back.
  for (let i = 0; i < 70; i++) {
    const x = (i * 97) % 760;
    const y = (i * 61) % 900;
    const r = 60 + ((i * 37) % 70);
    const col = greens[Math.min(greens.length - 1, Math.floor(i / 15))];
    leaves.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>`);
  }
  for (let i = 0; i < 26; i++) {
    const x = 60 + ((i * 131) % 680);
    const y = 40 + ((i * 89) % 820);
    const rot = (i * 47) % 180;
    const col = i % 5 === 0 ? C.lime : i % 3 === 0 ? "#7F9A35" : "#6C8A22";
    leaves.push(`<ellipse cx="${x}" cy="${y}" rx="46" ry="16" transform="rotate(${rot} ${x} ${y})" fill="${col}" opacity=".85"/>`);
  }
  const blocks: string[] = [];
  for (let row = 0; row < 8; row++) {
    const y = row * 96;
    const offset = row % 2 ? 0 : 110;
    for (let x = 640 - offset; x < 1600; x += 220) {
      blocks.push(`<rect x="${x}" y="${y}" width="216" height="92" fill="${row % 3 ? C.cream : "#E7DFCA"}"/>`);
    }
  }
  const skin = "#9C7257";
  const hair = "#231B16";
  return `<defs><linearGradient id="hw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9E1CC"/><stop offset="1" stop-color="#DCD1B6"/></linearGradient>
<radialGradient id="hl" cx=".8" cy=".05" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="hs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1E1E1E" stop-opacity=".25"/><stop offset="1" stop-color="#1E1E1E" stop-opacity="0"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#hw)"/>${blocks.join("")}
<rect x="600" width="1000" height="770" fill="url(#hs)" opacity=".5"/>
<rect y="770" width="1600" height="130" fill="${C.stone}"/><rect y="770" width="1600" height="4" fill="${C.stoneDark}"/>
<g>${leaves.join("")}</g>
<ellipse cx="1250" cy="782" rx="190" ry="16" fill="${C.ink}" opacity=".16"/>
<path d="M1442 690h96l10 92h-116z" fill="${C.lime}"/><path d="M1462 690q28-50 56 0" fill="none" stroke="${C.ink}" stroke-width="4"/><rect x="1478" y="720" width="24" height="15" fill="${C.ink}"/>
<path d="M1390 710h70l8 72h-86z" fill="${C.creamLight}"/><path d="M1404 710q21-38 42 0" fill="none" stroke="${C.ink}" stroke-width="3.5"/>
<rect x="1229" y="248" width="24" height="34" fill="${skin}"/>
<ellipse cx="1240" cy="214" rx="33" ry="41" fill="${skin}"/>
<path d="M1206 214q-4-58 38-60 44 2 30 58-6-30-34-30-24 0-34 32z" fill="${hair}"/><circle cx="1268" cy="176" r="19" fill="${hair}"/>
<path d="M1180 286 1240 272l60 14 30 44 16 232-24 4-14-150-2 172h-132l-2-172-14 150-24-4 16-232z" fill="${C.lime}"/>
<path d="M1240 272l60 14 30 44 16 232-24 4-14-150-2 172h-66z" fill="${C.ink}" opacity=".08"/>
<path d="M1222 278 1240 384l18-106" fill="none" stroke="${C.oliveDark}" stroke-width="3"/>
<path d="M1176 588h128l14 182h-64l-14-130-14 130h-64z" fill="#8FA61A"/>
<rect x="1158" y="764" width="70" height="14" rx="3" fill="${C.ink}"/><rect x="1252" y="764" width="70" height="14" rx="3" fill="${C.ink}"/>
<circle cx="1146" cy="570" r="11" fill="${skin}"/><circle cx="1334" cy="570" r="11" fill="${skin}"/>
<path d="M1296 602h96l9 120h-114z" fill="${C.creamLight}"/><path d="M1320 602q14-50 28 0" fill="none" stroke="${C.ink}" stroke-width="3.5"/>
<rect x="1332" y="640" width="28" height="17" fill="${C.ink}"/>
<rect width="1600" height="900" fill="url(#hl)"/>`;
}

export function heroArt(alt: string): { desktop: StorefrontImageData; mobile: StorefrontImageData } {
  return {
    desktop: { src: `${ART_BASE}/hero.desktop.svg`, alt, width: 1600, height: 900 },
    mobile: { src: `${ART_BASE}/hero.mobile.svg`, alt, width: 800, height: 1000 },
  };
}

/** SVG for an art key such as "dress.limeOnCream.detail" or "hero.mobile"; null if unknown. */
export function renderArt(key: string): string | null {
  if (key === "hero.desktop") return svgDoc(1600, 900, heroScene());
  if (key === "hero.mobile") return svgDoc(800, 1000, heroScene(), "920 100 640 800");
  const [kind, tone, extra] = key.split(".");
  if (!GARMENTS.includes(kind as Garment) || !(tone in tones)) return null;
  if (extra !== undefined && extra !== "detail") return null;
  return productSvg(kind as Garment, tones[tone as ToneName], extra === "detail");
}
