import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  projects: [
    { name: 'android-chromium', use: { ...devices['Pixel 5'] } },
    { name: 'ios-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
