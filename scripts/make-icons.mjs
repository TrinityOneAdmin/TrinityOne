// Generate the TrinityOne launcher icons from the Claude Design spec ("TrinityOne App Icons.html").
// Two apps, one Halo — the SAME mark, set apart only by the tile + spark (no extra rings):
//   member  — warm clay gradient, white Halo, gold-soft spark
//   steward — midnight gradient, paper Halo, brighter gold spark (identical geometry to member)
// Emits full adaptive sets (foreground + gradient background + legacy square/round) per density:
//   member  -> android/app/src/main/res/mipmap-*/         (the default build)
//   steward -> assets/steward-icons/mipmap-*/             (build-steward-apk.sh swaps these in)
//   node scripts/make-icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MEMBER = { grad: ['#CB6442', '#C25A38', '#9C4327'], mid: 0.42, halo: '#FFFFFF', spark: '#E0B860', sparkR: 6.5, keeper: null };
const STEWARD = { grad: ['#2C2316', '#241C12', '#17120B'], mid: 0.46, halo: '#F4EEE2', spark: '#C8962E', sparkR: 6.5, keeper: null };

// the Halo mark in its own 100x100 space, scaled+centred into an icon of side `size`
function halo(t, size, frac) {
  const s = (frac * size) / 100, off = (size - frac * size) / 2;
  const keeper = t.keeper ? `<circle cx="50" cy="50" r="13.5" fill="none" stroke="${t.keeper}" stroke-width="2.3" opacity="0.92"/>` : '';
  return `<g transform="translate(${off} ${off}) scale(${s})">
    <circle cx="50" cy="50" r="36" fill="none" stroke="${t.halo}" stroke-width="7" stroke-linecap="round" stroke-dasharray="57.4 18" transform="rotate(-90 50 50)"/>
    ${keeper}<circle cx="50" cy="50" r="${t.sparkR}" fill="${t.spark}"/></g>`;
}
function grad(t, size) {
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${t.grad[0]}"/><stop offset="${t.mid}" stop-color="${t.grad[1]}"/><stop offset="1" stop-color="${t.grad[2]}"/></linearGradient></defs>`;
}
const svg = (size, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${inner}</svg>`;
const bgSquare = (t, size) => svg(size, `${grad(t, size)}<rect width="${size}" height="${size}" fill="url(#g)"/>`);
const bgRound = (t, size) => svg(size, `${grad(t, size)}<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#g)"/>`);
const fullSquare = (t, size) => svg(size, `${grad(t, size)}<rect width="${size}" height="${size}" fill="url(#g)"/>${halo(t, size, 0.6)}`);
const fullRound = (t, size) => svg(size, `${grad(t, size)}<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#g)"/>${halo(t, size, 0.6)}`);
const fg = (t, size) => svg(size, halo(t, size, 0.52));            // adaptive foreground: halo on transparent (safe zone)

// density -> [legacy/round px, adaptive px]
const DENS = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
const png = (s, file) => sharp(Buffer.from(s)).png().toFile(file);

async function build(theme, outBase) {
  for (const [d, [base, adp]] of Object.entries(DENS)) {
    const dir = join(outBase, 'mipmap-' + d);
    mkdirSync(dir, { recursive: true });
    await png(fullSquare(theme, base), join(dir, 'ic_launcher.png'));
    await png(fullRound(theme, base), join(dir, 'ic_launcher_round.png'));
    await png(fg(theme, adp), join(dir, 'ic_launcher_foreground.png'));
    await png(bgSquare(theme, adp), join(dir, 'ic_launcher_background.png'));
  }
  console.log('  icons -> ' + outBase);
}

await build(MEMBER, join(ROOT, 'android', 'app', 'src', 'main', 'res'));
await build(STEWARD, join(ROOT, 'assets', 'steward-icons'));

// Android 12+ cold-start splash (Theme.SplashScreen → windowSplashScreenAnimatedIcon). The drawable is
// a 1152×1152 canvas and the OS centres + circle-masks it, so the Halo MUST be centred here (an
// off-centre mark reads as a lopsided "frame" on first launch). Dark ink Halo + gold spark on
// transparent; the platform paints @color/splash_bg (#F4EEE2 cream) behind it.
const SPLASH = { halo: '#2C2316', spark: '#C8962E', sparkR: 6.5, keeper: null };
await png(svg(1152, halo(SPLASH, 1152, 0.46)), join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash_icon.png'));

console.log('done — member (clay) into android res, steward (midnight) into assets/steward-icons, centred splash_icon');
