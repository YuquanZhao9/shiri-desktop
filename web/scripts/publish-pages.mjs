// 构建并发布到 GitHub Pages（公开仓库 YuquanZhao9/yushi-app 的 main 分支根目录）。
// 仓库只含构建好的网页程序，不含任何日程数据。用法：node scripts/publish-pages.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'https://github.com/YuquanZhao9/yushi-app.git';
const run = (cmd, args, cwd = process.cwd()) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });

run('npm', ['run', 'build']);
const work = mkdtempSync(join(tmpdir(), 'yushi-pages-'));
try {
  run('git', ['clone', '--depth', '1', REPO, work]);
  for (const entry of readdirSync(work)) if (entry !== '.git') rmSync(join(work, entry), { recursive: true, force: true });
  cpSync('dist', work, { recursive: true });
  writeFileSync(join(work, '.nojekyll'), '');
  writeFileSync(join(work, 'README.md'), '# 昱时 · iPhone 网页版\n\n在 iPhone 的 Safari 打开 https://yuquanzhao9.github.io/yushi-app/ ，点分享 → 添加到主屏幕。\n\n本仓库只放构建好的网页程序，不含任何日程数据。\n');
  run('git', ['add', '-A'], work);
  try { run('git', ['-c', 'user.name=YuquanZhao9', '-c', 'user.email=273347055+YuquanZhao9@users.noreply.github.com', 'commit', '-m', `发布 ${new Date().toISOString()}`], work); }
  catch { console.log('没有变化，无需发布'); process.exit(0); }
  run('git', ['push', 'origin', 'HEAD'], work);
  console.log('已发布：https://yuquanzhao9.github.io/yushi-app/');
} finally {
  rmSync(work, { recursive: true, force: true });
}
