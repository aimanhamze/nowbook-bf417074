// Generates src/assets/e_logo_light.png from src/assets/e_logo.png.
//
// The wordmark is two baked-in inks on a transparent canvas: navy (#000d33,
// the word "hjezly") and orange (#ff4d00, the calendar-"e" mark). On a dark
// surface the navy measures ~1.15:1 against the background — invisible — while
// the orange still clears 4.9:1. So this recolours ONLY the navy pixels to the
// app's cream (hsl(40 30% 96%) = #f7f4ef), keeps the orange, preserves alpha,
// and trims the ~120px of transparent padding so the <img> box is the artwork.
//
// The two inks never touch, so anti-aliased edges are navy↔transparent or
// orange↔transparent — never a navy/orange blend — and recolouring by channel
// test is exact. Re-run whenever e_logo.png changes:
//
//   node scripts/gen-logo-light.mjs
//
// This is a raster; it cannot be upscaled. The artwork inside the source is
// 357px wide, which is the hard ceiling for crisp rendering — see the size
// report the script prints.

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src", "assets", "e_logo.png");
const OUT = path.join(here, "..", "src", "assets", "e_logo_light.png");

const CREAM = { r: 0xf7, g: 0xf4, b: 0xef };
const MARGIN = 4; // transparent px kept around the trimmed artwork

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
let recoloured = 0;

for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    const a = data[i + 3];
    if (a === 0) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    // Navy ink: blue dominates red by a wide margin. Orange has red ≫ blue.
    if (data[i + 2] > data[i] + 20) {
      data[i] = CREAM.r; data[i + 1] = CREAM.g; data[i + 2] = CREAM.b;
      recoloured++;
    }
  }
}

const left = Math.max(0, minX - MARGIN);
const top = Math.max(0, minY - MARGIN);
const width = Math.min(info.width, maxX + MARGIN + 1) - left;
const height = Math.min(info.height, maxY + MARGIN + 1) - top;

await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .extract({ left, top, width, height })
  .png({ compressionLevel: 9, palette: false })
  .toFile(OUT);

const bytes = (await import("node:fs")).statSync(OUT).size;
console.log(`source   ${info.width}x${info.height}  artwork ${maxX - minX + 1}x${maxY - minY + 1}`);
console.log(`output   ${width}x${height}  ${(bytes / 1024).toFixed(1)} KB  (${recoloured} navy px → cream)`);
console.log(`crisp ceiling: ≤${Math.floor(width / 2)} css px wide @2x, ≤${Math.floor(width / 3)} css px wide @3x`);
