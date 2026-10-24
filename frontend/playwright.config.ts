import { defineConfig } from '@playwright/test'

// End-to-end run against the real app (./dev.sh starts FastAPI + Vite). Screenshots go to
// $SHOTS (default e2e/screenshots, gitignored) for every engine and size.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  // Both engines (WebKit = Safari) at a laptop, a typical MacBook and a 1080p projector.
  projects: (['chromium', 'webkit'] as const).flatMap((browserName) =>
    ([[1280, 720], [1440, 900], [1920, 1080]] as const).map(([width, height]) => ({
      name: `${browserName}-${height}`, use: { browserName, viewport: { width, height } },
    }))),
  webServer: {
    command: 'cd .. && ./dev.sh',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
