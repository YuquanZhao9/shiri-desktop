// Windows app icon ("日历对勾"): desktop/icon.svg -> multi-size desktop/icon.ico and tray PNGs.
// Usage: node scripts/desktop-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync('desktop/icon.svg', 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => ({ size, png: new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng() }));
// ICO with PNG-compressed entries (supported since Windows Vista); corners stay transparent.
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size >= 256 ? 0 : size; header[entry + 1] = size >= 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
writeFileSync('desktop/icon.ico', Buffer.concat([header, ...images.map(image => image.png)]));
for (const { size, png } of images) if ([16, 32, 64, 256].includes(size)) writeFileSync(`desktop/icon-${size}.png`, png);
console.log('desktop/icon.ico', sizes.join(','), offset, 'bytes');
