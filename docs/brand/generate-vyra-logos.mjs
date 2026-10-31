// VYRA logo generator: writes public/brand/*.svg, the PWA PNGs, src/app/icon.svg,
// src/app/apple-icon.png and src/app/favicon.ico, plus preview PNGs in <previewDir>.
// Usage (from the repo root): node docs/brand/generate-vyra-logos.mjs . <previewDir>
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';
const repo = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || os.tmpdir());
fs.mkdirSync(OUT, { recursive: true });
const BRAND = path.join(repo, 'public', 'brand');
fs.mkdirSync(BRAND, { recursive: true });

const C = { lime: '#9BB21E', olive: '#5F7A1F', cream: '#EDE6D3', ink: '#1E1E1E', overlap: '#4A6018' };

// ---------- Mark geometry (512 box) ----------
// Outer arms: left edge (64,96)->(256,448); arm width 108 at top.
function markShapes() {
  const leftArm = 'M64 96 H172 L310 349 L256 448 Z';
  const rightArm = 'M448 96 H340 L202 349 L256 448 Z';
  const overlap = 'M256 250 L310 349 L256 448 L202 349 Z';
  // Thin inner V in the notch (notch triangle 172,96 / 340,96 / 256,250)
  const innerLeft = 'M194 96 H218 L256 165 L256 210 Z';
  const innerRight = 'M318 96 H294 L256 165 L256 210 Z';
  return { leftArm, rightArm, overlap, innerLeft, innerRight };
}

function markGroup({ mono = null, simple = false } = {}) {
  const s = markShapes();
  if (mono) {
    // One colour, small sizes: no inner V; the left arm stops 14 units short of the right arm so the overlap still reads.
    return `<g fill="${mono}"><path d="M64 96 H172 L248 235.4 L194 334.4 Z"/><path d="${s.rightArm}"/></g>`;
  }
  if (simple) {
    return `<path fill="${C.olive}" d="${s.leftArm}"/><path fill="${C.lime}" d="${s.rightArm}"/><path fill="${C.overlap}" d="${s.overlap}"/>`;
  }
  return [
    `<path fill="${C.olive}" d="${s.leftArm}"/>`,
    `<path fill="${C.lime}" d="${s.rightArm}"/>`,
    `<path fill="${C.overlap}" d="${s.overlap}"/>`,
    `<path fill="${C.olive}" d="${s.innerLeft}"/>`,
    `<path fill="${C.lime}" d="${s.innerRight}"/>`,
  ].join('');
}

// ---------- Wordmark glyphs ----------
// VYRA, cap height 100, filled outlines, horizontal stem 13.
const big = {
  V: { w: 84, d: 'M0 0 H13 L42 82 L71 0 H84 L48.5 100 H35.5 Z' },
  Y: { w: 80, d: 'M0 0 H13 L40 43.5 L67 0 H80 L46.5 54 V100 H33.5 V54 Z' },
  R: {
    w: 66,
    d: 'M0 0 H36 A28 28 0 0 1 41.5 55.4 L66 100 H51 L27.5 56 H13 V100 H0 Z M13 13 V43 H36 A15 15 0 0 0 36 13 Z',
  },
  A: { w: 84, d: 'M35.5 0 H48.5 L84 100 H71 L62.3 75.5 H21.7 L13 100 H0 Z M26.1 63.5 H58 L42 18.3 Z' },
};

// Tagline glyphs: stroked, unit cap height 1.
const small = {
  W: { w: 0.96, d: 'M0 0 L0.24 1 L0.48 0.18 L0.72 1 L0.96 0' },
  E: { w: 0.52, d: 'M0.52 0 H0 V1 H0.52 M0 0.5 H0.46' },
  A: { w: 0.78, d: 'M0 1 L0.39 0 L0.78 1 M0.14 0.66 H0.64' },
  R: { w: 0.6, d: 'M0 1 V0 H0.3 A0.25 0.25 0 0 1 0.3 0.5 H0 M0.3 0.5 L0.58 1' },
  D: { w: 0.78, d: 'M0 0 V1 H0.28 A0.5 0.5 0 0 0 0.28 0 Z' },
  I: { w: 0, d: 'M0 0 V1' },
  F: { w: 0.5, d: 'M0.5 0 H0 V1 M0 0.5 H0.44' },
  N: { w: 0.72, d: 'M0 1 V0 L0.72 1 V0' },
  T: { w: 0.62, d: 'M0 0 H0.62 M0.31 0 V1' },
  ' ': { w: 0.5, d: '' },
};

const BIG_GAP = 46;
function wordmarkPaths(color) {
  const letters = 'VYRA'.split('');
  let x = 0;
  const parts = [];
  letters.forEach((ch, i) => {
    parts.push(`<path transform="translate(${x} 0)" d="${big[ch].d}"/>`);
    x += big[ch].w + (i < letters.length - 1 ? BIG_GAP : 0);
  });
  return { svg: `<g fill="${color}" fill-rule="evenodd">${parts.join('')}</g>`, width: x };
}

function taglinePaths(color, targetWidth, cap, y) {
  const text = 'WEAR DIFFERENT';
  const glyphs = text.split('').map((ch) => small[ch]);
  const sw = cap * 0.13; // stroke weight
  const inner = glyphs.reduce((a, g) => a + g.w, 0) * cap;
  // stroke adds sw/2 on each outer side; fit outer edges to targetWidth
  const gap = (targetWidth - sw - inner) / (glyphs.length - 1);
  let x = sw / 2;
  const parts = [];
  glyphs.forEach((g) => {
    if (g.d) parts.push(`<path transform="translate(${x.toFixed(2)} ${y}) scale(${cap})" d="${g.d}" stroke-width="${(sw / cap).toFixed(4)}"/>`);
    x += g.w * cap + gap;
  });
  return `<g fill="none" stroke="${color}" stroke-linejoin="miter" stroke-miterlimit="10" stroke-linecap="butt">${parts.join('')}</g>`;
}

function svg(viewBox, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
}

const files = {};
files['vyra-mark.svg'] = svg('0 0 512 512', `<g transform="translate(0 -16)">${markGroup()}</g>`, 'VYRA');
files['vyra-mark-mono.svg'] = svg('0 0 512 512', ('<g transform="translate(0 -16)">' + markGroup({ mono: C.ink }) + '</g>').replace(`fill="${C.ink}"`, 'fill="currentColor"'), 'VYRA');

const wm = wordmarkPaths(C.ink);
const TAG_CAP = 20;
const TAG_Y = 138;
const wordBody = wm.svg + taglinePaths(C.ink, wm.width, TAG_CAP, TAG_Y);
const pad = 24;
files['vyra-wordmark.svg'] = svg(`${-pad} ${-pad} ${wm.width + pad * 2} ${TAG_Y + TAG_CAP + pad * 2}`, wordBody, 'VYRA – Wear Different');

// Lockup: mark (scaled) centred above wordmark
const markSize = 260;
const markScale = markSize / 512;
const lockW = wm.width;
const markX = (lockW - markSize) / 2;
const wordY = markSize - 40 + 36; // mark bottom tip ~ y=448*scale; leave a gap
const lockBody =
  `<g transform="translate(${markX} 0) scale(${markScale})">${markGroup()}</g>` +
  `<g transform="translate(0 ${wordY})">${wordBody}</g>`;
const lockH = wordY + TAG_Y + TAG_CAP;
files['vyra-lockup.svg'] = svg(`${-pad} ${-pad + 40} ${lockW + pad * 2} ${lockH + pad * 2 - 40}`, lockBody, 'VYRA – Wear Different');

for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(BRAND, name), content);

// App icons
const iconBody = (bg, inset, simple = false) => {
  const s = 512 - inset * 2;
  return `<rect width="512" height="512" rx="${bg.rx}" fill="${bg.fill}"/><g transform="translate(${inset} ${inset - 14 * (s / 512)}) scale(${s / 512})">${markGroup({ simple })}</g>`;
};
const iconSvg = svg('0 0 512 512', iconBody({ fill: C.cream, rx: 112 }, 16, true), 'VYRA');
files['vyra-mark-small.svg'] = svg('0 0 512 512', `<g transform="translate(0 -16)">${markGroup({ simple: true })}</g>`, 'VYRA');
fs.writeFileSync(path.join(BRAND, 'vyra-mark-small.svg'), files['vyra-mark-small.svg']);
const appleSvg = svg('0 0 512 512', iconBody({ fill: C.cream, rx: 0 }, 72), 'VYRA');
fs.writeFileSync(path.join(repo, 'src', 'app', 'icon.svg'), iconSvg);

(async () => {
  const render = (content, w, out, bg) =>
    sharp(Buffer.from(content), { density: 600 })
      .resize({ width: w })
      .flatten(bg ? { background: bg } : undefined)
      .png()
      .toFile(path.join(OUT, out));
  for (const [name, content] of Object.entries(files)) {
    const base = name.replace('.svg', '');
    const c = content.replace(/currentColor/g, C.ink);
    await render(c, 512, `${base}-512.png`, '#ffffff');
    await render(c, name.includes('mark') ? 32 : 160, `${base}-small.png`, '#ffffff');
    await render(c, 512, `${base}-512-cream.png`, C.cream);
  }
  await sharp(Buffer.from(appleSvg), { density: 300 }).resize(180, 180).png().toFile(path.join(repo, 'src', 'app', 'apple-icon.png'));
  await sharp(Buffer.from(iconSvg), { density: 300 }).resize(32, 32).png().toFile(path.join(OUT, 'icon-32.png'));
  await sharp(Buffer.from(iconSvg), { density: 300 }).resize(16, 16).png().toFile(path.join(OUT, 'icon-16.png'));
  await sharp(Buffer.from(iconSvg), { density: 300 }).resize(48, 48).png().toFile(path.join(OUT, 'icon-48.png'));
  // PWA icons (manifest): full-bleed cream so launchers can apply their own mask.
  const pwaSvg = svg('0 0 512 512', iconBody({ fill: C.cream, rx: 0 }, 64), 'VYRA');
  const maskSvg = svg('0 0 512 512', iconBody({ fill: C.cream, rx: 0 }, 112), 'VYRA');
  await sharp(Buffer.from(pwaSvg), { density: 300 }).resize(192, 192).png().toFile(path.join(BRAND, 'vyra-icon-192.png'));
  await sharp(Buffer.from(pwaSvg), { density: 300 }).resize(512, 512).png().toFile(path.join(BRAND, 'vyra-icon-512.png'));
  await sharp(Buffer.from(maskSvg), { density: 300 }).resize(512, 512).png().toFile(path.join(BRAND, 'vyra-icon-maskable-512.png'));
  // favicon.ico with embedded PNGs (16, 32, 48)
  const pngs = await Promise.all([16, 32, 48].map((n) => sharp(Buffer.from(iconSvg), { density: 300 }).resize(n, n).png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((buf, i) => {
    const n = [16, 32, 48][i];
    const e = 6 + 16 * i;
    header.writeUInt8(n, e); header.writeUInt8(n, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  fs.writeFileSync(path.join(repo, 'src', 'app', 'favicon.ico'), Buffer.concat([header, ...pngs]));
  // Contact sheet: small sizes upscaled (nearest) so they can be inspected.
  const up = async (f, s) => sharp(path.join(OUT, f)).resize(s, s, { kernel: 'nearest' }).png().toBuffer();
  const sheet = sharp({ create: { width: 900, height: 300, channels: 4, background: '#ffffff' } }).composite([
    { input: await up('icon-16.png', 256), left: 10, top: 20 },
    { input: await up('icon-32.png', 256), left: 300, top: 20 },
    { input: await up('vyra-mark-mono-small.png', 256), left: 590, top: 20 },
  ]);
  await sheet.png().toFile(path.join(OUT, 'small-sheet.png'));
  console.log('ok');
})();
