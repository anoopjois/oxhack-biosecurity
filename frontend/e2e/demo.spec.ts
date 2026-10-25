import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const GM_RING = 'path.pin-ring[data-zone="greater-manchester"]'
test.describe.configure({ mode: 'serial' })

async function freshBackend(request: APIRequestContext) {
  await request.post('/api/v1/clock/pause')
  return (await (await request.post('/api/v1/clock/reset', { data: { seed: 42 } })).json()).clock
}

const dateForDay = (firstDate: string, day: number) =>
  new Date(Date.parse(firstDate) + day * 86_400_000).toISOString().slice(0, 10)

async function detect(request: APIRequestContext) {
  await request.post('/api/v1/trigger-outbreak', { data: { zone: 'greater-manchester', r: 0.4 } })
  for (let i = 0; i < 14; i++) {
    const status = await (await request.get('/api/v1/map-status')).json()
    if (status.clock.awaiting_approval) return
    expect((await request.post('/api/v1/clock/step')).ok()).toBeTruthy()
  }
  throw new Error('No incident detected')
}

async function expectFitsViewport(page: Page) {
  expect(await page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth > window.innerWidth || doc.scrollHeight > window.innerHeight
  })).toBe(false)
}

test('detection shows summary and explicit email approval, without hidden spike, stock or rideshare', async ({ page, request }, info) => {
  const initial = await freshBackend(request)
  await page.goto('/')
  await expect(page.getByTestId('coach')).toBeVisible()
  await page.getByTestId('coach-dismiss').click()
  await page.getByTestId('spike').click()
  await page.locator(GM_RING).click()
  await page.getByTestId('spike-inject').click()
  await expect(page.getByTestId('spike-dialog')).toBeHidden()
  await expect(page.getByTestId('incidents-empty')).toBeVisible()
  for (let day = 28; day <= 41; day++) {
    await page.getByTestId('step').click()
    await expect(page.getByTestId('clock-date')).toHaveAttribute('datetime', dateForDay(initial.first_date, day))
    if (await page.locator(`${GM_RING}[data-status="CRITICAL"]`).count()) break
  }
  const card = page.getByTestId('incident')
  await expect(card).toHaveAttribute('data-phase', 'critical')
  await expect(page.getByTestId('incident-summary')).toContainText('critical early-warning')
  await expect(page.getByTestId('approve')).toHaveText('Approve & send report')
  await expect(page.getByTestId('step')).toBeEnabled()
  await expect(card).not.toContainText(/hidden from the system|pooled rides|briefing|Stock moved/i)
  await expect(page.locator('path.arc')).toHaveCount(0)
  await expectFitsViewport(page)
  await page.screenshot({ path: `${process.env.SHOTS ?? 'e2e/screenshots'}/${info.project.name}-alert-approval.png` })
  // Never approve real email in e2e. Provider delivery is covered by mocked backend tests.
  const stock = await (await request.get('/api/v1/inventory')).json()
  await page.getByTestId('override').click()
  await expect(card).toContainText('Notification dismissed')
  await expect(page.getByTestId('approve')).toHaveCount(0)
  expect(await (await request.get('/api/v1/inventory')).json()).toEqual(stock)
  await page.reload()
  await expect(page.getByTestId('incident')).toContainText('Notification dismissed')
})

test('pending approval survives reload and never blocks steps', async ({ page, request }) => {
  await freshBackend(request)
  await detect(request)
  await page.goto('/')
  await expect(page.getByTestId('approve')).toBeVisible()
  const before = await page.getByTestId('clock-date').getAttribute('datetime')
  await page.getByTestId('step').click()
  await expect(page.getByTestId('clock-date')).not.toHaveAttribute('datetime', before!)
  await expect(page.getByTestId('approve')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('approve')).toBeVisible()
})

test('Run demo reaches the end without automatic emails and resets cleanly', async ({ page, request }) => {
  const initial = await freshBackend(request)
  await page.goto('/')
  await page.getByTestId('run-demo').click()
  await expect(page.getByTestId('incident')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('clock-date')).toHaveAttribute('datetime', initial.last_date, { timeout: 30_000 })
  await expect(page.getByTestId('approve')).toBeVisible()
  await expect(page.getByTestId('end-banner')).toBeVisible()
  await expect(page.getByTestId('play')).toBeDisabled()
  await page.locator('body').press('r')
  await page.getByTestId('reset-confirm').getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByTestId('incidents-empty')).toBeVisible()
})

test('keyboard shortcuts, theme and offline map remain available', async ({ page, request }) => {
  const initial = await freshBackend(request)
  await page.goto('/')
  await page.getByTestId('coach-dismiss').click()
  await page.locator('body').press('ArrowRight')
  await expect(page.getByTestId('clock-date')).toHaveAttribute('datetime', dateForDay(initial.first_date, 28))
  await page.locator('body').press('s')
  await expect(page.getByTestId('spike-dialog')).toBeVisible()
  await page.getByTestId('spike-r-input').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('clock-date')).toHaveAttribute('datetime', dateForDay(initial.first_date, 28))
  await page.keyboard.press('Escape')
  await page.getByTestId('theme').click()
  await page.getByTestId('theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.route('**://tile.openstreetmap.org/**', (route) => route.abort())
  await page.getByTestId('help').click()
  await page.getByTestId('map-tiles').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('path.base-england')).toHaveCount(1)
  await expectFitsViewport(page)
})
