import { defineConfig } from '@playwright/test'

// End-to-end run against the real app (./dev.sh starts FastAPI + Vite). Screenshots go to
// $SHOTS (default e2e/screenshots, gitignored) at both projector and laptop sizes.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: '1080p', use: { browserName: 'chromium', viewport: { width: 1920, height: 1080 } } },
    { name: '720p', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
  ],
  webServer: {
    command: 'cd .. && ./dev.sh',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
