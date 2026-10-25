import { defineConfig } from '@playwright/test'
import { loadEnv } from 'vite'

// End-to-end run against the real app (./dev.sh starts FastAPI + Vite). Screenshots go to
// $SHOTS (default e2e/screenshots, gitignored) for every engine and size.
// The port comes from the repo-root .env or the environment, like vite.config.ts and dev.sh,
// so a second checkout on other ports never silently reuses someone else's server.
const port = loadEnv('', '..', '').FRONTEND_PORT || '5173'
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  // Both engines (WebKit = Safari) at a laptop, a typical MacBook and a 1080p projector.
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ([[1280, 720], [1440, 900], [1920, 1080]] as const).map(([width, height]) => ({
      name: `${browserName}-${height}`, use: { browserName, viewport: { width, height } },
    }))),
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'cd .. && ./dev.sh',
    // The health check goes through Vite's /api proxy, so it only passes once BOTH servers are
    // up. Waiting on Vite alone let the first test start while a cold backend was still booting.
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
