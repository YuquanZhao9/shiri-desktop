'use strict';

// Static package verification does not launch the packaged executable.
// Usage: node desktop/verify-package.cjs [unpacked-directory] [portable-exe]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

const project = path.resolve(__dirname, '..');
const directory = path.resolve(process.argv[2] || path.join(project, 'release', 'win-unpacked'));
const archive = path.join(directory, 'resources', 'app.asar');
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
// @electron/asar resolves nested directories with the host platform separator.
// Normalize URL-style paths before querying its filesystem on Windows.
const extract = (name) => asar.extractFile(archive, path.normalize(name));
const packaged = JSON.parse(extract('package.json').toString('utf8'));
assert.equal(packaged.main, 'desktop/main.cjs');
const files = ['desktop/main.cjs', 'desktop/preload.cjs', 'desktop/reminders.cjs', 'dist/index.html'];
const hashes = {};
for (const name of files) {
  const buffer = extract(name);
  hashes[name] = sha(buffer);
  assert.equal(hashes[name], sha(fs.readFileSync(path.join(project, name))), `packaged ${name} is out of date`);
}
const helper = path.join(directory, 'resources', 'app.asar.unpacked', 'desktop', 'desktop.ps1');
assert.equal(sha(fs.readFileSync(helper)), sha(fs.readFileSync(path.join(project, 'desktop', 'desktop.ps1'))), 'native helper must be unpacked and current');
const index = extract('dist/index.html').toString('utf8');
const scripts = [...index.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map((match) => `dist/${match[1]}`);
assert.ok(scripts.some((name) => name.endsWith('.js')), 'HTML should load a relative bundled JavaScript asset');
for (const name of scripts) {
  const buffer = extract(name);
  assert.ok(buffer.length > 0, `missing packaged asset: ${name}`);
  assert.equal(sha(buffer), sha(fs.readFileSync(path.join(project, name))), `packaged asset ${name} is out of date`);
}
// Include lazy chunks, manifest, service worker and icons, beyond the HTML's imports.
const assetHashes = {};
function verifyAssetDirectory(relative) {
  for (const entry of fs.readdirSync(path.join(project, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) verifyAssetDirectory(name);
    else if (entry.isFile()) {
      const expected = sha(fs.readFileSync(path.join(project, name)));
      assert.equal(sha(extract(name)), expected, `packaged ${name} is out of date`);
      assetHashes[name.replaceAll(path.sep, '/')] = expected;
    }
  }
}
verifyAssetDirectory('dist');

function inspectExecutable(file, requireX64 = true) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString('ascii', 0, 2), 'MZ');
  const pe = buffer.readUInt32LE(0x3c);
  assert.equal(buffer.toString('ascii', pe, pe + 4), 'PE\u0000\u0000');
  const machine = buffer.readUInt16LE(pe + 4);
  if (requireX64) assert.equal(machine, 0x8664, 'application executable should target x64');
  else assert.ok([0x14c, 0x8664].includes(machine), 'portable launcher should be a Windows x86/x64 PE');
  return { file, bytes: buffer.length, sha256: sha(buffer), architecture: machine === 0x8664 ? 'x64' : 'x86 launcher (payload checked separately)' };
}
const executable = inspectExecutable(path.join(directory, `${packaged.build?.productName || '昱时'}.exe`));
const portable = process.argv[3] ? inspectExecutable(path.resolve(process.argv[3]), false) : null;
console.log(JSON.stringify({ ok: true, archive, executable, portable, files: hashes, helper, assets: scripts, assetHashes, executed: false }, null, 2));
