import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

const SHOTS = process.env.SHOTS ?? 'e2e/screenshots'
const GM_RING = 'path.pin-ring[data-zone="greater-manchester"]'
const GM_CRITICAL = `${GM_RING}[data-status="CRITICAL"]`

test.describe.configure({ mode: 'serial' })

async function freshBackend(request: APIRequestContext) {
  await request.post('/api/v1/clock/pause')
  await request.post('/api/v1/clock/reset', { data: { seed: 42 } })
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` })
}

/** Nothing may spill outside the viewport: no page scroll, and the main panels end on screen. */
async function expectFitsViewport(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    const panels = ['.header', '.cell-map', '.cell-side', '.timeline'].map((s) => document.querySelector(s)!.getBoundingClientRect())
    return {
      scroll: doc.scrollWidth > window.innerWidth || doc.scrollHeight > window.innerHeight,
      offscreen: panels.some((r) => r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5),
    }
  })
  expect(overflow).toEqual({ scroll: false, offscreen: false })
}

test('manual flow: spike, step to CRITICAL, approve the stock move, arcs, incident card, chart, play to end, reset', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.goto('/')
  await expect(page.getByTestId('clock-day')).toHaveText('Day 27 of 41')
  await expect(page.getByTestId('simulated-badge')).toBeVisible()
  await expect(page.locator('path.pin-ring')).toHaveCount(42)
  await expect(page.locator('path.base-england')).toHaveCount(1)  // built-in vector map by default
  await expect(page.locator('img.leaflet-tile')).toHaveCount(0)
  await expect(page.getByTestId('coach')).toBeVisible()
  await expectFitsViewport(page)
  await shot(page, info, '1-start')
  await page.getByTestId('coach-dismiss').click()
  await expect(page.getByTestId('coach')).toBeHidden()

  // Spike: open the popover, pick Greater Manchester by clicking its ring, inject at r = 0.4.
  await page.getByTestId('spike').click()
  await expect(page.getByTestId('spike-dialog')).toBeVisible()
  await page.locator(GM_RING).click()
  await expect(page.getByTestId('spike-zone')).toHaveValue('greater-manchester')
  await expect(page.getByTestId('spike-doubling')).toContainText('1.7 days')
  await page.getByTestId('spike-inject').click()
  await expect(page.getByTestId('spike-dialog')).toBeHidden()
  const card = page.getByTestId('incident')
  await expect(card).toHaveAttribute('data-phase', 'watching')
  await expect(card.locator('[data-step="injected"]')).toContainText('hidden from the system')
  await expect(page.getByTestId('zone-panel')).toContainText('Greater Manchester')

  // Step until Greater Manchester turns CRITICAL.
  for (let day = 28; day <= 41; day++) {
    await page.getByTestId('step').click()
    await expect(page.getByTestId('clock-day')).toHaveText(`Day ${day} of 41`)
    if (day === 30) await shot(page, info, '2-mid')
    if (await page.locator(GM_CRITICAL).count()) break
  }
  await expect(page.locator(GM_CRITICAL)).toHaveCount(1)
  await expect(page.locator('path.pin-pulse')).not.toHaveCount(0)
  await expect(page.locator('path.arc')).toHaveCount(3)
  await expect(card).toHaveAttribute('data-phase', 'critical')

  // The stock move is only proposed: the clock is held until a person approves (or 30 s pass).
  const stock = card.locator('[data-step="stock"]')
  await expect(stock).toHaveAttribute('data-variant', 'await')
  await expect(page.getByTestId('approval-countdown')).toContainText(/Auto-approves in \d+ s unless someone objects/)
  await expect(page.getByTestId('donor-safety')).toContainText(/would (each )?keep \d+\.\d days of reserve after giving/)
  await expect(page.getByTestId('clock-held')).toBeVisible()
  await expect(page.getByTestId('step')).toBeDisabled()
  // Fully visible, buttons included: pinned to the bottom of the incident list.
  await expect(page.getByTestId('approval')).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('approve')).toBeInViewport({ ratio: 1 })
  await page.waitForTimeout(800)
  await expectFitsViewport(page)
  await shot(page, info, '3a-approval')
  await page.getByTestId('approve').click()
  await expect(page.getByTestId('decision-tag')).toHaveText('✓ Approved by operator')
  await expect(page.getByTestId('approval')).toBeHidden()
  await expect(page.getByTestId('donor-safety')).toContainText(/(each keep|keeps) \d+\.\d days of reserve after giving/)
  await expect(page.getByTestId('clock-held')).toBeHidden()
  await expect(page.getByTestId('step')).toBeEnabled()
  for (const step of ['detected', 'stock', 'briefing', 'containment']) {
    await expect(card.locator(`[data-step="${step}"]`)).toHaveClass(/step-done/)
  }
  await expect(page.getByTestId('briefing-source')).toHaveText('Rule-based briefing')
  await expect(page.getByTestId('chart-spike')).toBeVisible()
  await expect(page.getByTestId('chart-alert')).toBeVisible()
  await expect(page.getByTestId('tl-alert')).toBeVisible()
  await page.waitForTimeout(2600) // arcs finish drawing, labels fade in
  await expect(page.locator('.arc-label').first()).toContainText('PPE')
  await expect(page.locator('.arc-label').first()).toContainText(/keeps \d+\.\d days of reserve/)
  await expect(page.locator('.arc-arrow').first()).toBeVisible()
  await expect(page.locator('.zone-label-pinned[data-zone="greater-manchester"]')).toBeVisible() // survives the flight
  await expectFitsViewport(page)
  await shot(page, info, '3-critical')

  await page.getByTestId('stock-toggle').click()
  await expect(page.getByTestId('stock-table')).toContainText('Cheshire and Merseyside')
  await expect(page.getByTestId('stock-table')).toContainText('Reserve after')
  await page.getByTestId('stock-toggle').click()
  await page.getByTestId('briefing-toggle').click()
  expect(await page.getByTestId('directive').count()).toBeGreaterThanOrEqual(3)
  await shot(page, info, '4-briefing')
  await page.getByTestId('briefing-toggle').click()

  // Step past the point where the current score reaches 80: the lead caption appears.
  for (let i = 0; i < 3; i++) await page.getByTestId('step').click()
  await expect(page.getByTestId('lead-note')).toContainText(/Alert raised (\d+ days?|the same day)/)

  // Play at 0.5 s/day to the end: auto-pause and the end-of-timeline bar with a reason.
  await page.getByTestId('speed').click()
  await page.getByTestId('speed-0.5').click()
  await page.getByTestId('play').click()
  await expect(page.getByTestId('pause')).toBeVisible()
  await expect(page.getByTestId('clock-day')).toHaveText('Day 41 of 41', { timeout: 30_000 })
  await expect(page.getByTestId('end-banner')).toContainText('Timeline ended')
  await expect(page.getByTestId('play')).toBeDisabled()
  await expect(page.getByTestId('play')).toHaveAttribute('title', /Timeline ended/)
  await expect(page.getByTestId('tl-hit')).toBeVisible()
  await expect(page.locator('path.arc')).toHaveCount(0, { timeout: 25_000 }) // arcs fade; camera flies back
  await page.waitForTimeout(1500)
  await expectFitsViewport(page)
  await shot(page, info, '5-end')

  // Reset with the keyboard (asks first).
  await page.locator('body').press('r')
  await page.getByTestId('reset-confirm').getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByTestId('clock-day')).toHaveText('Day 27 of 41')
  await expect(page.getByTestId('incidents-empty')).toBeVisible()
  await expect(page.locator('path.pin-ring[data-status="CRITICAL"]')).toHaveCount(0)
})

test('Run demo, and reloading mid-demo does not replay the arcs', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.goto('/')
  await expect(page.getByTestId('coach')).toBeVisible()
  await page.getByTestId('run-demo').click()
  await expect(page.getByTestId('coach')).toBeHidden()
  await expect(page.getByTestId('pause')).toBeVisible()
  await expect(page.getByTestId('speed')).toHaveText(/1s \/ day/)
  await expect(page.getByTestId('incident')).toBeVisible()
  await expect(page.getByTestId('zone-panel')).toContainText('Greater Manchester')
  await expect(page.locator(GM_CRITICAL)).toHaveCount(1, { timeout: 20_000 })
  await expect(page.locator('path.arc')).toHaveCount(3)
  // Held for the approval while still in play mode; the day does not advance.
  await expect(page.getByTestId('approval')).toBeVisible()
  const heldDay = await page.getByTestId('clock-day').textContent()
  await page.waitForTimeout(2500)
  await expect(page.getByTestId('clock-day')).toHaveText(heldDay!)
  await page.locator('body').press(' ')
  await expect(page.getByTestId('play')).toBeVisible()
  await page.waitForTimeout(2600)
  await shot(page, info, '6-run-demo')

  await page.reload()
  await expect(page.locator(GM_CRITICAL)).toHaveCount(1)
  await expect(page.getByTestId('incident')).toHaveAttribute('data-phase', 'critical')
  await page.waitForTimeout(2000)
  await expect(page.locator('path.arc')).toHaveCount(0)  // old allocations are history, not news
  await expect(page.getByTestId('approval')).toBeVisible() // the pending decision survives a reload
})

test('override: nothing moves, the arcs clear and the clock runs on', async ({ page, request }, info) => {
  await freshBackend(request)
  await request.post('/api/v1/trigger-outbreak', { data: { zone: 'greater-manchester', r: 0.4 } })
  const before = await (await request.get('/api/v1/inventory')).json()
  for (let i = 0; i < 14; i++) {
    const status = await (await request.get('/api/v1/map-status')).json()
    if (status.clock.awaiting_approval) break
    await request.post('/api/v1/clock/step')
  }
  await page.goto('/')
  await page.getByTestId('incident').locator('button.incident-name').click()
  await page.getByTestId('incident').locator('[data-step="stock"]').getByText('Show on map').click()
  await expect(page.locator('path.arc')).toHaveCount(3)
  await page.getByTestId('override').click()
  const stock = page.getByTestId('incident').locator('[data-step="stock"]')
  await expect(stock).toHaveAttribute('data-variant', 'overridden')
  await expect(page.getByTestId('overridden')).toContainText('no stock moved')
  await expect(page.locator('path.arc')).toHaveCount(0)
  await expect(page.getByTestId('step')).toBeEnabled()
  const after = await (await request.get('/api/v1/inventory')).json()
  expect(after).toEqual(before)
  await shot(page, info, '6b-overridden')
})

test('zoom buttons and dark mode', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.goto('/')
  await page.getByTestId('coach-dismiss').click()
  const gm = page.locator(GM_RING)
  const devon = page.locator('path.pin-ring[data-zone="devon"]')
  const gap = async () => {
    const [a, b] = [await gm.boundingBox(), await devon.boundingBox()]
    return Math.hypot(a!.x - b!.x, a!.y - b!.y)
  }
  const start = await gap()
  await page.getByTestId('zoom-in').click()
  await expect.poll(gap).toBeGreaterThan(start * 1.5)
  await page.getByTestId('zoom-out').click()
  await page.getByTestId('zoom-out').click()
  await expect.poll(gap).toBeLessThan(start * 1.01)
  await page.getByTestId('zoom-fit').click()
  await expect.poll(gap).toBeCloseTo(start, -1)

  // Theme: auto -> light -> dark, remembered across a reload.
  await page.getByTestId('theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByTestId('theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(await background()).toBe('rgb(15, 17, 21)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expectFitsViewport(page)
  await shot(page, info, '10-dark')
  await page.getByTestId('theme').click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/)
})

test('keyboard shortcuts, and none fire while using a form control', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.goto('/')
  await expect(page.getByTestId('clock-day')).toHaveText('Day 27 of 41')
  const body = page.locator('body')

  await body.press('ArrowRight')
  await expect(page.getByTestId('clock-day')).toHaveText('Day 28 of 41')

  await body.press('s')
  await expect(page.getByTestId('spike-dialog')).toBeVisible()
  await page.getByTestId('spike-r-input').focus()
  await page.keyboard.press(' ')            // typing target: must NOT toggle play
  await page.keyboard.press('ArrowRight')   // moves the slider, must NOT step
  await expect(page.getByTestId('play')).toBeVisible()
  await expect(page.getByTestId('clock-day')).toHaveText('Day 28 of 41')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('spike-dialog')).toBeHidden()

  await body.press(' ')
  await expect(page.getByTestId('pause')).toBeVisible()
  await body.press(' ')
  await expect(page.getByTestId('play')).toBeVisible()

  await body.press('?')
  await expect(page.getByTestId('help-popover')).toContainText('About the risk score')
  await shot(page, info, '7-help')
  await page.keyboard.press('Escape')
  await body.press('r')
  await expect(page.getByTestId('reset-confirm')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reset-confirm')).toBeHidden()
})

test('street map: greyscale tiles at whole zoom levels, no stale levels', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.goto('/')
  await page.getByTestId('coach-dismiss').click()
  await page.getByTestId('help').click()
  await page.getByTestId('map-tiles').check()
  await page.keyboard.press('Escape')
  const loaded = await page.locator('img.leaflet-tile-loaded').first().waitFor({ timeout: 8_000 }).then(() => true, () => false)
  test.skip(!loaded, 'OpenStreetMap tiles unreachable from this machine')
  await page.waitForTimeout(2500)
  // Seam-free: the only tile level holding tiles is drawn at scale 1 (a whole zoom level).
  const levels = await page.evaluate(() => [...document.querySelectorAll('.leaflet-tile-container')]
    .filter((c) => c.querySelector('img.leaflet-tile-loaded'))
    .map((c) => (c as HTMLElement).style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? '1'))
  expect(levels).toEqual(['1'])
  await shot(page, info, '8-street-map')
})

test('offline: blocked street-map tiles fall back to the built-in map', async ({ page, request }, info) => {
  await freshBackend(request)
  await page.route('**://tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByTestId('coach-dismiss').click()
  await page.getByTestId('help').click()
  // click(), not check(): with tiles blocked the app may fall back (unticking the radio) at once.
  await page.getByTestId('map-tiles').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('path.base-england')).toHaveCount(1)
  await expect(page.locator('path.pin-ring')).toHaveCount(42)
  await shot(page, info, '9-offline')
})
