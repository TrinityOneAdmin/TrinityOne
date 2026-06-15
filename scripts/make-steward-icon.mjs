// Generate the Steward console's launcher icon — the SAME Halo logo as the member app, with the
// colours SWAPPED: the member icon is a clay background + light Halo; the steward icon is a light
// (cream) background + clay Halo (gold spark kept). Outputs a full Android mipmap set into
// assets/steward-icons/, which scripts/build-steward-apk.sh swaps into the project for the steward APK.
//   node scripts/make-steward-icon.mjs
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'steward-icons');

const CREAM = '#F4EAD9';   // swapped: was the clay background
const CLAY = '#C25A38';    // swapped: now the Halo ring
const GOLD = '#C8962E';    // spark (accent, unchanged)

// the Halo mark (matches icons.jsx): a near-full ring with a small spark.
const ring = (r, sw) => `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${CLAY}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="57.4 18" transform="rotate(-90 50 50)"/><circle cx="50" cy="50" r="6.5" fill="${GOLD}"/>`;
const svgSquare = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><rect width="100" height="100" fill="${CREAM}"/>${ring(34, 7)}</svg>`;
const svgRound  = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${CREAM}"/>${ring(34, 7)}</svg>`;
// adaptive foreground: transparent, mark sits inside the ~66% safe zone (smaller ring + more padding)
const svgFg     = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${ring(26, 5.5)}</svg>`;

// density -> [legacy/round px, foreground px]
const DENS = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };

const png = (svg, file) => sharp(Buffer.from(svg)).png().toFile(file);

for (const [d, [base, fg]] of Object.entries(DENS)) {
  const dir = join(OUT, 'mipmap-' + d);
  mkdirSync(dir, { recursive: true });
  await png(svgSquare(base), join(dir, 'ic_launcher.png'));
  await png(svgRound(base), join(dir, 'ic_launcher_round.png'));
  await png(svgFg(fg), join(dir, 'ic_launcher_foreground.png'));
  console.log('  wrote mipmap-' + d + ' (' + base + 'px, fg ' + fg + 'px)');
}
console.log('steward icons -> assets/steward-icons/  (background colour: ' + CREAM + ')');
