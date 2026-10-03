import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 数据格式、重复规则、节假日和同步逻辑直接取自桌面版源码，保证两端完全一致。
const shared = fileURLToPath(new URL('../拾日/src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@shared': shared },
    // 桌面版 cloud.ts 也引用 supabase-js；只打包一份。
    dedupe: ['@supabase/supabase-js', 'react', 'react-dom'],
  },
  server: { port: 5180, strictPort: true, fs: { allow: ['..'] } },
});
