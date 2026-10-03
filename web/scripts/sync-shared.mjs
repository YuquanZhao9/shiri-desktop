// 把桌面版的数据代码复制进云函数目录（Deno 需要带 .ts 后缀的导入）。
// 部署云函数前运行：node scripts/sync-shared.mjs；tests/ai-sync.test.ts 会检查两边一致。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const SHARED = ['types.ts', 'core.ts', 'timetable.ts', 'holidays.ts'];
const from = new URL('../../拾日/src/', import.meta.url);
const to = new URL('../supabase/functions/_shared/', import.meta.url);

export function denoSource(source) {
  return source.replace(/from '\.\/([a-z-]+)'/g, "from './$1.ts'");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sync-shared.mjs')) {
  mkdirSync(to, { recursive: true });
  for (const file of SHARED) {
    const source = readFileSync(new URL(file, from), 'utf8');
    writeFileSync(new URL(file, to), `// 自动从 拾日/src/${file} 复制，请勿手改；运行 node scripts/sync-shared.mjs 更新。\n` + denoSource(source));
  }
  console.log('shared copied:', SHARED.join(', '));
}
