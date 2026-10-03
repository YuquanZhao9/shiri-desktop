// Copies the iPhone web app and the project notes into this repo (web/ and docs/)
// so the whole project lives in one GitHub repo. Run from the repo root on the
// Windows PC where the sources live side by side:
//   node scripts/sync-repo-extras.mjs
// Never copies node_modules, build output or any .env* file except .env.example.
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const repo = resolve('.');
const outputs = resolve(repo, '..');
const web = join(outputs, '昱时-手机网页版');
const docs = ['当前进度.md', '测试记录.md', '使用说明.md', '昱时-项目交接.md'];

if (!existsSync(web)) throw new Error(`找不到手机网页版源码：${web}`);
const skip = new Set(['node_modules', 'dist', '.git']);
rmSync(join(repo, 'web'), { recursive: true, force: true });
cpSync(web, join(repo, 'web'), {
  recursive: true,
  filter: (source) => {
    const name = basename(source);
    if (skip.has(name)) return false;
    if (name.startsWith('.env') && name !== '.env.example') return false;
    return !(statSync(source).isFile() && /\.(exe|zip)$/i.test(name));
  },
});

mkdirSync(join(repo, 'docs'), { recursive: true });
for (const name of docs) {
  const source = join(outputs, name);
  if (existsSync(source)) cpSync(source, join(repo, 'docs', name));
}
console.log('已同步 web/ 和 docs/');
