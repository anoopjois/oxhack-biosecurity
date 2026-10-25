import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Clock, MapStatus, SimEvent, ZoneHistory } from '../src/api/types'
import { clock, event, zone } from '../tests/fixtures'

const sizes = [
  [1920, 1080], [1440, 900], [1280, 720], [1024, 768],
  [768, 1024], [390, 844], [320, 568], [844, 390], [1280, 720],
] as const

const zones = [
  zone('greater-manchester', { status: 'CRITICAL', score: 82, projected_score: 94,
    r_hat: 0.4, doubling_days: 1.7 }),
  zone('bath-and-north-east-somerset', {
    zone_name: 'NHS Bath and North East Somerset, Swindon and Wiltshire',
    latitude: 51.4, longitude: -2.4, status: 'CRITICAL',
  }),
  zone('north-east-london', { latitude: 51.5, longitude: 0, status: 'CRITICAL' }),
]
const incidents = [
  event('OUTBREAK_INJECTED', { r: 0.4 }, { event_id: 1, sim_date: '2026-09-28' }),
  ...zones.flatMap((z, index) => [
  event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL', projected_score: 94 },
    { event_id: index * 2 + 2, zip_code: z.zip_code }),
  event('INCIDENT_OPENED', { episode_id: index + 1, status: 'awaiting_approval',
    recipient: 'outbreak-notifications@example.test',
    summary: `${z.zone_name} has a critical early-warning forecast for viral outbreak risk. Review the observed signals before approving a report.` },
  { event_id: index * 2 + 3, zip_code: z.zip_code }),
])]

async function mockSimulation(page: Page, current: Clock, events: SimEvent[]) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    expect(route.request().method(), 'Layout checks must never mutate the simulation or send mail').toBe('GET')
    if (url.pathname.endsWith('/map-status')) {
      const data: MapStatus = { clock: current, zones, approvals: [] }
      return route.fulfill({ json: data })
    }
    if (url.pathname.endsWith('/events')) {
      const since = Number(url.searchParams.get('since_id') ?? 0)
      return route.fulfill({ json: { events: events.filter((e) => e.event_id > since),
        last_id: events.at(-1)?.event_id ?? 0 } })
    }
    if (url.pathname.endsWith('/history')) {
      const zip = url.pathname.split('/').at(-2)!
      const selected = zones.find((z) => z.zip_code === zip)!
      const data: ZoneHistory = { zip_code: zip, zone_name: selected.zone_name,
        days: Array.from({ length: current.day + 1 }, (_, day) => ({
          day, date: new Date(Date.UTC(2026, 8, day + 1)).toISOString().slice(0, 10),
          status: day >= 31 ? 'CRITICAL' : 'SAFE', score: day >= 33 ? 82 : 20,
          projected_score: day >= 31 ? 94 : 22,
        })) }
      return route.fulfill({ json: data })
    }
    throw new Error(`Unexpected API request: ${url.pathname}`)
  })
  await page.goto('/')
  await expect(page.getByTestId('clock-date')).toBeVisible()
}

async function fitsHorizontally(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.width)
}

async function insideViewport(locator: Locator) {
  await expect(locator).toBeInViewport()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  const viewport = locator.page().viewportSize()!
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function noSiblingOverlap(locator: Locator) {
  const overlaps = await locator.evaluate((parent) => {
    const children = Array.from(parent.children).map((el) => el.getBoundingClientRect())
    return children.some((a, i) => children.slice(i + 1).some((b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1))
  })
  expect(overlaps).toBe(false)
}

test('resizing preserves the map, chart, long names and all incident approval controls', async ({ page }, info) => {
  await mockSimulation(page, clock({ day: 33, sim_date: '2026-10-04', awaiting_approval: true }), incidents)
  await page.locator('.incident-name').nth(1).click()
  await expect(page.getByTestId('zone-panel')).toBeVisible()
  await expect(page.getByTestId('score-chart').locator('svg')).toBeVisible()
  for (const [width, height] of sizes) {
    await test.step(`${width}x${height}`, async () => {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => window.scrollTo(0, 0))
      await fitsHorizontally(page)
      await noSiblingOverlap(page.locator('.header'))
      await noSiblingOverlap(page.locator('.controls'))
      await noSiblingOverlap(page.locator('.stats'))
      await noSiblingOverlap(page.locator('.card-head'))
      await noSiblingOverlap(page.locator('.incident-head').nth(1))
      await insideViewport(page.getByTestId('clock'))
      await insideViewport(page.getByTestId('help'))
      if (width === 390 || width === 1280) {
        await page.locator('.cell-side').evaluate((el) => { el.scrollTop = 0 })
        await page.screenshot({ path: info.outputPath(`layout-${width}-${height}.png`), fullPage: true })
      }
      const map = await page.getByTestId('map').boundingBox()
      if (width <= 760 || height <= 600) {
        expect(map!.width).toBeCloseTo(width - 24, 0)
      } else {
        expect(map!.width).toBeGreaterThanOrEqual(300)
      }
      expect(map!.height).toBeGreaterThanOrEqual(300)
      await expect.poll(async () => {
        const bounds = await page.getByTestId('map').boundingBox()
        return page.locator('.zone-label-pinned:visible').evaluateAll((labels, box) =>
          labels.every((label) => {
            const rect = label.getBoundingClientRect()
            return rect.left >= box!.x && rect.right <= box!.x + box!.width
          }), bounds)
      }).toBe(true)
      if (width <= 760) {
        await expect(page.locator('.zone-label-pinned:visible')).toHaveCount(1)
        await page.locator('path.pin-ring[data-zone="greater-manchester"]').hover()
        await expect(page.locator('.leaflet-tooltip.zone-label-compact')).toContainText('Greater Manchester')
        await insideViewport(page.locator('.leaflet-tooltip.zone-label-compact'))
        await page.mouse.move(0, 0)
      }
      for (const button of await page.getByTestId('approve').all()) {
        await button.scrollIntoViewIfNeeded()
        await button.click({ trial: true })
        await insideViewport(button)
      }
      await page.getByRole('button', { name: 'About Viral doubling time' }).scrollIntoViewIfNeeded()
      await page.getByRole('button', { name: 'About Viral doubling time' }).click()
      await insideViewport(page.getByRole('tooltip'))
      await page.keyboard.press('Escape')
      await fitsHorizontally(page)
    })
  }
})

test('header dialogs stay on screen and scroll at phone, tablet and landscape sizes', async ({ page }) => {
  await mockSimulation(page, clock(), incidents)
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    for (const [button, dialog] of [
      ['help', 'help-popover'], ['spike', 'spike-dialog'], ['reset', 'reset-confirm'],
    ]) {
      await page.getByTestId(button).click()
      await insideViewport(page.getByTestId(dialog))
      await fitsHorizontally(page)
      if (dialog === 'spike-dialog') {
        await page.getByTestId('spike-zone').selectOption(zones[1].zip_code)
        await page.getByTestId('spike-dialog').getByRole('button', { name: 'Cancel' }).click()
      } else {
        await page.keyboard.press('Escape')
      }
    }
    await page.getByTestId('speed').click()
    await insideViewport(page.getByRole('menu', { name: 'Speed' }))
    await page.getByTestId('speed-0.5').click()
    await expect(page.getByTestId('speed')).toContainText('0.5s')
  }
})

test('dashboard opens without a welcome popup and end-of-timeline actions remain accessible', async ({ page }) => {
  const current = clock({ day: 27, sim_date: '2026-09-28' })
  await mockSimulation(page, current, [])
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.getByRole('dialog', { name: 'Getting started' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Explore on my own' })).toHaveCount(0)
    await expect(page.getByTestId('run-demo')).toBeVisible()
    await page.getByTestId('zoom-in').click({ trial: true })
    await fitsHorizontally(page)
  }
  current.day = 41
  current.sim_date = current.last_date
  current.at_end = true
  await page.reload()
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.scrollTo(0, 0))
    await insideViewport(page.getByTestId('end-banner'))
    await page.getByTestId('replay-demo').click({ trial: true })
    await page.getByTestId('zoom-fit').click({ trial: true })
    await fitsHorizontally(page)
  }
})

test('nearby spike and alert labels do not overlap in the chart or timeline', async ({ page }) => {
  await mockSimulation(page, clock({ day: 33, sim_date: '2026-10-04' }), incidents)
  await page.locator('.incident-name').last().click()
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height })
    const spike = page.getByTestId('chart-spike').locator('rect')
    const alert = page.getByTestId('chart-alert').locator('rect')
    await expect(spike).toBeVisible()
    await expect(alert).toBeVisible()
    await expect.poll(async () => {
      const a = (await spike.boundingBox())!
      const b = (await alert.boundingBox())!
      return Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
        Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y)
    }).toBe(true)
    const labels = await page.locator('.tl-marker-label').evaluateAll((items) =>
      items.map((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }))
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j]
        expect(Math.min(a.right, b.right) <= Math.max(a.left, b.left) ||
          Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top), `${width}x${height}`).toBe(true)
      }
    }
  }
})

test('opening another header panel closes the previous panel', async ({ page }) => {
  await mockSimulation(page, clock(), incidents)
  await page.getByTestId('help').click()
  await expect(page.getByTestId('help-popover')).toBeVisible()
  await page.keyboard.press('s')
  await expect(page.getByTestId('help-popover')).toBeHidden()
  await expect(page.getByTestId('spike-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('r')
  await expect(page.getByTestId('reset-confirm')).toBeVisible()
  await page.getByTestId('speed').click()
  await expect(page.getByTestId('reset-confirm')).toBeHidden()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByTestId('spike').click()
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(page.getByTestId('spike-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('speed').click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
})

test('dashboard explains viral outbreak risk and its inputs without badges or simulation counters', async ({ page }, info) => {
  await mockSimulation(page, clock({ day: 33, sim_date: '2026-10-04' }), incidents)
  await expect(page.getByTestId('poc-badge')).toHaveCount(0)
  await expect(page.getByText('Viral outbreak early warning', { exact: true })).toBeVisible()
  const logo = page.getByRole('img', { name: 'BioSecure' })
  await expect(logo).toBeVisible()
  await expect.poll(() => logo.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await expect(page.locator('.brand-dot')).toHaveCount(0)
  await expect(page.getByText('BioSecure', { exact: true })).toHaveCount(0)
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 720 })
    const brand = await page.locator('.brand').evaluate((element) => {
      const title = element.querySelector('img')!.getBoundingClientRect()
      const purpose = element.querySelector('p')!.getBoundingClientRect()
      return { beside: purpose.left >= title.right, overlappingRows: purpose.top < title.bottom && purpose.bottom > title.top }
    })
    expect(brand.beside && brand.overlappingRows).toBe(true)
  }
  await expect(page.getByTestId('clock-date')).toHaveAttribute('datetime', '2026-10-04')
  await expect(page.locator('body')).not.toContainText(/proof of concept|synthetic|simulated data|day \d+ of \d+/i)
  const explanation = page.getByTestId('risk-explanation')
  await expect(explanation).toContainText('Wastewater viral load50%')
  await expect(explanation).toContainText('A&E waiting-time pressure35%')
  await expect(explanation).toContainText('Mobility & crowding15%')
  await expect(explanation).toContainText('not an infection probability')
  await page.screenshot({ path: info.outputPath('poc-overview.png') })
  await page.getByRole('button', { name: 'Greater Manchester: 48-hour outbreak risk 94 out of 100' }).click()
  await expect(page.getByTestId('zone-panel').locator('.stats')).toContainText('Outbreak risk now')
  await expect(page.getByTestId('zone-panel').locator('.stats')).toContainText('Outbreak risk in 48h')
  await expect(page.getByTestId('zone-panel').locator('.stats')).toContainText('Viral doubling time')
  await expect(page.getByTestId('zone-panel').locator('.stats')).toContainText('82 / 100')
  await expect(page.getByTestId('zone-panel').locator('.stats')).toContainText('94 / 100')
  await expect(page.locator('body')).not.toContainText(/synthetic|simulated data|day \d+ of \d+/i)
})
