// macOS app icon: desktop/icon.svg -> desktop/icon.icns (needs macOS iconutil).
// Usage: node scripts/mac-icon.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync('desktop/icon.svg', 'utf8');
const set = join(mkdtempSync(join(tmpdir(), 'shiri-icon-')), 'icon.iconset');
execFileSync('mkdir', [set]);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size * scale } }).render().asPng();
    writeFileSync(join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), png);
  }
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', 'desktop/icon.icns']);
rmSync(join(set, '..'), { recursive: true, force: true });
console.log('desktop/icon.icns');
