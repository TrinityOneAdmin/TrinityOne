// Generate the TrinityOne launcher icons from the Claude Design spec ("TrinityOne App Icons.html").
// Two apps, one Halo — the SAME mark, set apart only by the tile + spark (no extra rings):
//   member  — warm clay gradient, white Halo, gold-soft spark
//   steward — midnight gradient, paper Halo, brighter gold spark (identical geometry to member)
//   finance — the steward tile + Halo, with a small gold open LEDGER where the spark sits (owner D2, 2026-11-17:
//             "Steward-style icon with a ledger mark")
// Emits full adaptive sets (foreground + gradient background + legacy square/round) per density:
//   member  -> android/app/src/main/res/mipmap-*/         (the default build)
//   steward -> assets/steward-icons/mipmap-*/             (build-steward-apk.sh swaps these in)
//   finance -> assets/finance-icons/mipmap-*/             (build-finance-apk.sh swaps these in)
//              + icons/finance-192.png, icons/finance-apple-touch.png, icons/finance-512.png from icons/finance-halo.svg
//                (finance.html + finance.webmanifest) and icons/finance-maskable-512.png (finance.webmanifest's maskable
//                icon: the same full-bleed square tile as the Android legacy icon, its Halo inside the 80% safe zone)
//   node scripts/make-icons.mjs                everything
//   node scripts/make-icons.mjs finance        the finance set only (touches nothing else)
//   node scripts/make-icons.mjs finance-web    the finance WEB icons only (icons/finance-*; no Android files)
//   node scripts/make-icons.mjs finance-desktop  the DESKTOP program's 1024px source icon only ->
//                                              assets/finance-desktop-icon.png (the same tile + Halo + ledger as the
//                                              Android finance icon, on a rounded square). `tauri icon` turns it into
//                                              the per-OS set (finance-app/desktop/src-tauri/icons/, gitignored).
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MEMBER = { grad: ['#CB6442', '#C25A38', '#9C4327'], mid: 0.42, halo: '#FFFFFF', spark: '#E0B860', sparkR: 6.5, keeper: null };
const STEWARD = { grad: ['#2C2316', '#241C12', '#17120B'], mid: 0.46, halo: '#F4EEE2', spark: '#C8962E', sparkR: 6.5, keeper: null };
const FINANCE = { ...STEWARD, ledger: true };

// The ledger mark, in the Halo's 100x100 space: an open book centred where the spark sits, gold pages with two
// ruled lines each in the tile colour. Kept well inside the ring (its inner edge is r=32.5; the book spans 38.5-61.5).
// icons/finance-halo.svg draws these same paths, scaled into its 512 space.
const LEDGER_PAGES = 'M49 42.5 Q44 40 38.5 40.5 L38.5 58 Q44 57.5 49 60 Z M51 42.5 Q56 40 61.5 40.5 L61.5 58 Q56 57.5 51 60 Z';
const LEDGER_RULES = 'M41.5 47 L46.5 48.2 M41.5 51.5 L46.5 52.7 M53.5 48.2 L58.5 47 M53.5 52.7 L58.5 51.5';
const ledger = (gold, ink) => `<path d="${LEDGER_PAGES}" fill="${gold}"/><path d="${LEDGER_RULES}" stroke="${ink}" stroke-width="1.3" stroke-linecap="round" fill="none"/>`;

// the Halo mark in its own 100x100 space, scaled+centred into an icon of side `size`
function halo(t, size, frac) {
  const s = (frac * size) / 100, off = (size - frac * size) / 2;
  const keeper = t.keeper ? `<circle cx="50" cy="50" r="13.5" fill="none" stroke="${t.keeper}" stroke-width="2.3" opacity="0.92"/>` : '';
  return `<g transform="translate(${off} ${off}) scale(${s})">
    <circle cx="50" cy="50" r="36" fill="none" stroke="${t.halo}" stroke-width="7" stroke-linecap="round" stroke-dasharray="57.4 18" transform="rotate(-90 50 50)"/>
    ${keeper}${t.ledger ? ledger(t.spark, t.grad[1]) : `<circle cx="50" cy="50" r="${t.sparkR}" fill="${t.spark}"/>`}</g>`;
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

// the web icons finance.html links and finance.webmanifest lists (the console's are icons/steward-192.png +
// steward-apple-touch.png). The maskable one is full-bleed (no rounded corners: the browser applies its own mask).
async function buildFinanceWeb() {
  const web = readFileSync(join(ROOT, 'icons', 'finance-halo.svg'));
  await sharp(web, { density: 300 }).resize(192, 192).png().toFile(join(ROOT, 'icons', 'finance-192.png'));
  await sharp(web, { density: 300 }).resize(180, 180).png().toFile(join(ROOT, 'icons', 'finance-apple-touch.png'));
  await sharp(web, { density: 300 }).resize(512, 512).png().toFile(join(ROOT, 'icons', 'finance-512.png'));
  await png(fullSquare(FINANCE, 512), join(ROOT, 'icons', 'finance-maskable-512.png'));
  console.log('  icons -> icons/finance-192.png, icons/finance-apple-touch.png, icons/finance-512.png, icons/finance-maskable-512.png');
}
// the desktop program's source icon (T1Finance desktop plan §2): 1024px, rounded square — the shape a desktop dock or
// Start menu shows (the OS does not mask it, unlike Android's adaptive icon).
const roundedSquare = (t, size) => svg(size, `${grad(t, size)}<rect width="${size}" height="${size}" rx="${Math.round(size * 0.2237)}" fill="url(#g)"/>${halo(t, size, 0.6)}`);
async function buildFinanceDesktop() {
  await png(roundedSquare(FINANCE, 1024), join(ROOT, 'assets', 'finance-desktop-icon.png'));
  console.log('  icon -> assets/finance-desktop-icon.png (1024px)');
}
async function buildFinance() {
  await build(FINANCE, join(ROOT, 'assets', 'finance-icons'));
  await buildFinanceWeb();
}
if (process.argv[2] === 'finance-web') { await buildFinanceWeb(); process.exit(0); }
if (process.argv[2] === 'finance') { await buildFinance(); process.exit(0); }
if (process.argv[2] === 'finance-desktop') { await buildFinanceDesktop(); process.exit(0); }

await build(MEMBER, join(ROOT, 'android', 'app', 'src', 'main', 'res'));
await build(STEWARD, join(ROOT, 'assets', 'steward-icons'));
await buildFinance();
await buildFinanceDesktop();

// Android 12+ cold-start splash (Theme.SplashScreen → windowSplashScreenAnimatedIcon). The drawable is
// a 1152×1152 canvas and the OS centres + circle-masks it, so the Halo MUST be centred here (an
// off-centre mark reads as a lopsided "frame" on first launch). Dark ink Halo + gold spark on
// transparent; the platform paints @color/splash_bg (#F4EEE2 cream) behind it.
const SPLASH = { halo: '#2C2316', spark: '#C8962E', sparkR: 6.5, keeper: null };
await png(svg(1152, halo(SPLASH, 1152, 0.46)), join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable', 'splash_icon.png'));

console.log('done — member (clay) into android res, steward (midnight) into assets/steward-icons, finance (midnight + ledger) into assets/finance-icons, centred splash_icon');
