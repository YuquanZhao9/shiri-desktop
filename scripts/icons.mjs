import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

// Encode the opaque App Store icon as true RGB PNG (color type 2), with no
// alpha channel. Other sizes keep transparency for desktop/web use.
function opaquePng(rendered) {
  const { width, height, pixels } = rendered;
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (y * width + x) * 4;
    if (pixels[source + 3] !== 255) throw new Error('iOS app icon must be fully opaque');
    pixels.copy(scanlines, y * (width * 3 + 1) + 1 + x * 3, source, source + 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length, 0);
    body.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

const iosOnly = process.argv.includes('--ios-only');
const svg=readFileSync('public/icon.svg','utf8');
for(const width of (iosOnly ? [1024] : [192,256,512,1024])) {
  const rendered=new Resvg(svg,{fitTo:{mode:'width',value:width},...(width===1024?{background:'#5c6fd6'}:{})}).render();
  const png=width===1024?opaquePng(rendered):rendered.asPng();
  if(!iosOnly)writeFileSync(`public/icon-${width}.png`,png);
  if(width===256){const head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);head.writeUInt32LE(png.length,14);head.writeUInt32LE(22,18);writeFileSync('desktop/icon.ico',Buffer.concat([head,png]));}
  if(width===1024&&existsSync('ios/App/App/Assets.xcassets/AppIcon.appiconset')){
    writeFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',png);
    writeFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json',JSON.stringify({images:[{filename:'AppIcon-512@2x.png',idiom:'universal',platform:'ios',size:'1024x1024'}],info:{author:'xcode',version:1}},null,2));
  }
}
