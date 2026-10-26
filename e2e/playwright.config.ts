import { defineConfig, devices } from '@playwright/test';

// 端到端测试：在浏览器里打开桌面版（5173）和 iPhone 网页版（5180），只用本机数据。
// 两个开发服务器都把云配置清空，测试里另外拦截所有外网请求，绝不连真实的 Supabase。
const noCloud = { VITE_SUPABASE_URL: '', VITE_SUPABASE_KEY: '', VITE_VAPID_PUBLIC_KEY: '' };

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',
  use: {
    locale: 'zh-CN',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testMatch: 'desktop.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, baseURL: 'http://127.0.0.1:5173' } },
    { name: 'iphone', testMatch: 'iphone.spec.ts', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: 'http://127.0.0.1:5180' } },
  ],
  webServer: [
    { command: 'npx vite --host 127.0.0.1 --port 5173 --strictPort', cwd: '..', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, env: noCloud },
    { command: 'npx vite --host 127.0.0.1 --port 5180 --strictPort', cwd: '../web', url: 'http://127.0.0.1:5180', reuseExistingServer: !process.env.CI, env: noCloud },
  ],
});
