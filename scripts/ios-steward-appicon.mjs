// Render the STEWARD console's iOS app icon from its vector source.
//
// Why this is separate from ios-fixup.sh's icon step: the member app and the steward
// console are built from the SAME gitignored ios/ project with a content swap, so they
// share one AppIcon. ios-fixup.sh generates the MEMBER icon (from assets/, via
// @capacitor/assets). When building the steward console for iOS, run THIS after it to
// overwrite that with the steward mark, so the console does not ship the member flame.
//
// icons/steward-halo.svg is a COMPLETE icon (dark ground #241C12, cream broken-ring, gold
// dot) — a vector, so it rasterises crisply at any size. iOS applies its own rounded-rect
// mask, and the icon must be OPAQUE (no alpha), so we flatten onto the same dark ground.
//
// sharp ships as part of @capacitor/assets (a devDependency); no extra install is needed.
//   Run:  node scripts/ios-steward-appicon.mjs
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'icons/steward-halo.svg');
const OUT = join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');

if (!existsSync(SRC)) { console.error(`steward-appicon: ${SRC} not found`); process.exit(1); }
if (!existsSync(dirname(OUT))) {
  console.error(`steward-appicon: ${dirname(OUT)} not found — run 'npx cap add ios' and ios-fixup.sh first`);
  process.exit(1);
}

// density 384 oversamples the 512-unit SVG so the downscale to 1024 stays sharp.
const info = await sharp(SRC, { density: 384 })
  .resize(1024, 1024)
  .flatten({ background: '#241C12' })   // strip alpha → opaque, iOS-safe
  .png()
  .toFile(OUT);
console.log(`steward-appicon: wrote ${OUT} (${info.width}x${info.height}, ${info.channels}ch)`);
