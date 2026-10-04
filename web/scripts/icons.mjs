// 生成网页版图标（“日历对勾”方案）。用法：node scripts/icons.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { Resvg } = require('@resvg/resvg-js');

const body = '<rect x="52" y="66" width="152" height="140" rx="22" fill="#fff"/><path d="M52 88a22 22 0 0 1 22-22h108a22 22 0 0 1 22 22v18H52z" fill="#FF6B5B"/><rect x="86" y="50" width="16" height="34" rx="8" fill="#fff"/><rect x="154" y="50" width="16" height="34" rx="8" fill="#fff"/><path d="M94 152 L118 176 L164 128" fill="none" stroke="#2E5BE8" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>';
const defs = '<defs><linearGradient id="g0" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B8CFF"/><stop offset="1" stop-color="#2E5BE8"/></linearGradient></defs>';
const svg = (rx, scale = 1) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${defs}<rect width="256" height="256" rx="${rx}" fill="url(#g0)"/><g transform="translate(${128 - 128 * scale} ${128 - 128 * scale}) scale(${scale})">${body}</g></svg>`;
const png = (source, size, file) => writeFileSync(file, new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng());

writeFileSync('public/icon.svg', svg(56));
png(svg(0), 180, 'public/apple-touch-icon.png');   // iOS 自己裁圆角，必须铺满
png(svg(56), 192, 'public/icon-192.png');
png(svg(56), 512, 'public/icon-512.png');
png(svg(0, 0.8), 512, 'public/icon-maskable-512.png'); // 内容缩进安全区
console.log('icons written');
