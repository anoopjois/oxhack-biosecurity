import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

const SHOTS = process.env.SHOTS ?? 'e2e/screenshots'
const GM_PIN = 'path.pin-zone-greater-manchester'

test.describe.configure({ mode: 'serial' })

async function freshBackend(request: APIRequestContext) {
  await request.post('/api/v1/clock/pause')
  await request.post('/api/v1/clock/reset', { data: { seed: 42 } })
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` })
}

test('manual flow: spike, step to CRITICAL, arcs, briefing, inventory, zone chart, play to end, reset',
  async ({ page, request }, info) => {
    await freshBackend(request)
    await page.goto('/')
    await expect(page.getByTestId('clock-day')).toHaveText('Day 27 / 41')
    await expect(page.getByTestId('simulated-badge')).toBeVisible()
    await expect(page.locator('path.pin')).toHaveCount(42)
    await page.waitForTimeout(2500) // let map tiles load for the screenshot
    await shot(page, info, '01-start')

    // Spike: open the dialog, pick Greater Manchester by clicking its pin, inject at r = 0.4.
    await page.getByTestId('spike').click()
    await expect(page.getByTestId('spike-dialog')).toBeVisible()
    await page.locator(GM_PIN).click()
    await expect(page.getByTestId('spike-zone')).toHaveValue('greater-manchester')
    await expect(page.getByTestId('spike-doubling')).toContainText('1.7 days')
    await shot(page, info, '02-spike-dialog')
    await page.getByTestId('spike-inject').click()
    await expect(page.getByTestId('spike-dialog')).toBeHidden()
    const feed = page.getByTestId('feed')
    await expect(feed).toContainText('Simulated pathogen spike in Greater Manchester')

    // Step until Greater Manchester turns CRITICAL.
    for (let day = 28; day <= 41; day++) {
      await page.getByTestId('step').click()
      await expect(page.getByTestId('clock-day')).toHaveText(`Day ${day} / 41`)
      if (await page.locator(`${GM_PIN}.pin-critical`).count()) break
    }
    await expect(page.locator(`${GM_PIN}.pin-critical`)).toHaveCount(1)
    await expect(page.locator('path.pin-halo')).not.toHaveCount(0)
    await expect(page.locator('path.arc')).not.toHaveCount(0)
    await expect(page.locator('.arc-label').first()).toContainText('PPE')
    await expect(feed.locator('[data-type="AGENT_ALLOCATION"]')).toHaveCount(1)
    await expect(feed.locator('[data-type="AGENT_DIRECTIVE"]')).toHaveCount(1)
    await expect(feed.locator('[data-type="RIDESHARE_WEBHOOK"]')).toHaveCount(1)
    await expect(feed.getByTestId('briefing-source')).toHaveText('Rule-based briefing')
    await expect(page.getByTestId('inventory-target')).toHaveText('Greater Manchester')
    if (info.project.name === '720p') await expect(page.getByTestId('inventory-table')).toContainText('(target)')
    await page.waitForTimeout(2600)
    await expect(page.locator('.arc-arrow').first()).toBeVisible() // arcs finish drawing, labels appear
    await shot(page, info, '03-critical-arcs')

    await feed.getByTestId('briefing-toggle').click()
    expect(await feed.getByTestId('directive').count()).toBeGreaterThanOrEqual(3)
    await expect(feed.getByTestId('directive').first()).toContainText('IMMEDIATE')
    await shot(page, info, '04-briefing-expanded')

    // Zone panel (selected on injection): chart with the 80 line, then the lead note once 80 is crossed.
    const panel = page.getByTestId('zone-panel')
    await expect(panel).toContainText('Greater Manchester')
    await expect(page.getByTestId('score-chart')).toContainText('CRITICAL 80')
    for (let i = 0; i < 3; i++) await page.getByTestId('step').click()
    await expect(page.getByTestId('lead-note')).toContainText(/Alert raised (\d+ days?|on the day)/)
    await shot(page, info, '05-zone-lead')

    // Play at 0.5 s/day to the end: auto-pause and a timeline-end card.
    await page.getByRole('button', { name: '0.5s' }).click()
    await page.getByTestId('play').click()
    await expect(page.getByTestId('pause')).toBeVisible()
    await expect(page.getByTestId('clock-day')).toHaveText('Day 41 / 41', { timeout: 30_000 })
    await expect(page.getByTestId('play')).toBeDisabled()
    await expect(feed.locator('[data-type="TIMELINE_END"]')).toHaveCount(1)
    await expect(page.locator(`${GM_PIN}.pin-critical`)).toHaveCount(1)
    await shot(page, info, '06-end')

    // Reset with the keyboard (asks first).
    await page.locator('body').press('r')
    await expect(page.getByTestId('reset-confirm')).toBeVisible()
    await page.getByTestId('reset-confirm').getByRole('button', { name: 'Reset' }).click()
    await expect(page.getByTestId('clock-day')).toHaveText('Day 27 / 41')
    await expect(feed).toContainText('No events yet')
    await expect(page.getByTestId('inventory')).toContainText('No transfers yet')
    await expect(page.locator('path.pin-critical')).toHaveCount(0)
    await shot(page, info, '07-reset')
  })

test('Run demo: one click resets, injects Greater Manchester and plays at 1 s/day', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.goto('/')
  await expect(page.getByTestId('clock-day')).toHaveText('Day 27 / 41')
  await page.getByTestId('run-demo').click()
  await expect(page.getByTestId('pause')).toBeVisible()
  await expect(page.getByRole('button', { name: '1s' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('feed')).toContainText('Simulated pathogen spike in Greater Manchester')
  await expect(page.getByTestId('zone-panel')).toContainText('Greater Manchester')
  await expect(page.locator(`${GM_PIN}.pin-critical`)).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('path.arc')).not.toHaveCount(0)
  await page.waitForTimeout(2600)
  await shot(page, info, '08-run-demo')
  await page.locator('body').press(' ')
  await expect(page.getByTestId('play')).toBeVisible()
})

test('keyboard shortcuts, and none fire while using a form control', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.goto('/')
  await expect(page.getByTestId('clock-day')).toHaveText('Day 27 / 41')
  const body = page.locator('body')

  await body.press('ArrowRight')
  await expect(page.getByTestId('clock-day')).toHaveText('Day 28 / 41')

  await body.press('s')
  await expect(page.getByTestId('spike-dialog')).toBeVisible()
  await page.getByTestId('spike-r-input').focus()
  await page.keyboard.press(' ')            // typing target: must NOT toggle play
  await page.keyboard.press('ArrowRight')   // moves the slider, must NOT step
  await expect(page.getByTestId('play')).toBeVisible()
  await expect(page.getByTestId('clock-day')).toHaveText('Day 28 / 41')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('spike-dialog')).toBeHidden()

  await body.press(' ')
  await expect(page.getByTestId('pause')).toBeVisible()
  await body.press(' ')
  await expect(page.getByTestId('play')).toBeVisible()

  await page.waitForTimeout(1500) // tiles settle for the screenshot
  await body.press('?')
  await expect(page.getByTestId('help-popover')).toBeVisible()
  await shot(page, info, '09-help')
  await page.keyboard.press('Escape')
  await body.press('r')
  await expect(page.getByTestId('reset-confirm')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reset-confirm')).toBeHidden()
})

test('offline: blocked map tiles fall back to the bundled outline', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.route('**://tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('path.offline-england')).toHaveCount(1)
  await expect(page.locator('path.pin')).toHaveCount(42)
  await expect(page.getByTestId('map-offline')).toHaveAttribute('aria-pressed', 'true')
  await shot(page, info, '10-offline')
})
