// Layer A: pure logic.
import { describe, expect, it } from 'vitest'
import { leadMarkers, pollInterval, shortcutFor, shouldUseOffline } from '../src/lib/behaviour'
import { buildFeed, isDefaultVisible, latestAllocation } from '../src/lib/events'
import { compact, doublingDays, longDate, shortDate, shortName } from '../src/lib/format'
import { arcPoints, arrowRotation } from '../src/lib/geo'
import { inventoryBars } from '../src/lib/inventory'
import { countByStatus, pinRadius, PIN_MIN_RADIUS, PIN_RADIUS_RANGE, STATUS_META } from '../src/lib/status'
import { allocation, briefing, event } from './fixtures'

describe('status and pins', () => {
  it('maps every status to a colour and a text label', () => {
    expect(STATUS_META.CRITICAL).toMatchObject({ label: 'Critical', color: '#d03b3b' })
    expect(STATUS_META.ELEVATED.ink).toBe('#1a1a1a') // dark text on amber for contrast
    expect(countByStatus(['SAFE', 'SAFE', 'CRITICAL'])).toEqual({ CRITICAL: 1, ELEVATED: 0, SAFE: 2, INSUFFICIENT_DATA: 0 })
  })

  it('sizes pins by sqrt(population): monotonic and bounded', () => {
    const max = 3_100_000
    const radii = [0, 510_000, 1_000_000, 2_900_000, max, 9e9].map((p) => pinRadius(p, max))
    expect(radii[0]).toBe(PIN_MIN_RADIUS)
    expect(radii[4]).toBe(PIN_MIN_RADIUS + PIN_RADIUS_RANGE)
    expect(radii[5]).toBe(radii[4])
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1])
    // area ∝ population: a quarter of the population gives half the extra radius
    expect(pinRadius(max / 4, max) - PIN_MIN_RADIUS).toBeCloseTo(PIN_RADIUS_RANGE / 2)
  })
})

describe('arcs', () => {
  const from: [number, number] = [53.3, -2.7]
  const to: [number, number] = [53.5, -2.25]

  it('has exact endpoints and n + 1 points', () => {
    const pts = arcPoints(from, to, 32)
    expect(pts).toHaveLength(33)
    expect(pts[0]).toEqual(from)
    expect(pts[32]).toEqual(to)
  })

  it('bulges to one side of the straight line', () => {
    const pts = arcPoints(from, to, 32)
    const k = Math.cos((53.4 * Math.PI) / 180)
    const side = (p: [number, number]) =>
      Math.sign((to[1] - from[1]) * k * (p[0] - from[0]) - (to[0] - from[0]) * (p[1] - from[1]) * k)
    const sides = new Set(pts.slice(1, -1).map(side))
    expect(sides.size).toBe(1)
  })

  it('points the arrowhead along the last segment', () => {
    expect(arrowRotation([[52, -1], [52, 0]])).toBeCloseTo(0)     // due east
    expect(arrowRotation([[52, 0], [53, 0]])).toBeCloseTo(-90)    // due north = up on screen
  })
})

describe('event feed', () => {
  it('default filter: injections, transitions to CRITICAL, agent events, webhooks, timeline end', () => {
    expect(isDefaultVisible(event('OUTBREAK_INJECTED'))).toBe(true)
    expect(isDefaultVisible(event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL' }))).toBe(true)
    expect(isDefaultVisible(event('STATUS_CHANGE', { from: 'SAFE', to: 'ELEVATED' }))).toBe(false)
    expect(isDefaultVisible(event('STATUS_CHANGE', { from: 'CRITICAL', to: 'ELEVATED' }))).toBe(false)
    for (const t of ['AGENT_ALLOCATION', 'AGENT_DIRECTIVE', 'RIDESHARE_WEBHOOK', 'TIMELINE_END']) {
      expect(isDefaultVisible(event(t))).toBe(true)
    }
  })

  it('shows everything with "show all": newest day first, chronological within a day', () => {
    const evs = [
      event('OUTBREAK_INJECTED', {}, { sim_date: '2026-09-28' }),
      event('STATUS_CHANGE', { from: 'SAFE', to: 'ELEVATED' }, { sim_date: '2026-09-30' }),
      event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL' }, { sim_date: '2026-10-02' }),
      event('AGENT_ALLOCATION', {}, { sim_date: '2026-10-02' }),
      event('RIDESHARE_WEBHOOK', {}, { sim_date: '2026-10-02' }),
    ]
    expect(buildFeed(evs, false)).toHaveLength(4)
    expect(buildFeed(evs, true).map((i) => [i.date, i.event.type])).toEqual([
      ['2026-10-02', 'STATUS_CHANGE'], ['2026-10-02', 'AGENT_ALLOCATION'], ['2026-10-02', 'RIDESHARE_WEBHOOK'],
      ['2026-09-30', 'STATUS_CHANGE'], ['2026-09-28', 'OUTBREAK_INJECTED'],
    ])
  })

  it('keeps one briefing per episode; the AI version replaces the rule-based one in place', () => {
    const evs = [
      event('AGENT_DIRECTIVE', briefing('template', 'Rule headline') as unknown as Record<string, unknown>),
      event('RIDESHARE_WEBHOOK'),
      event('AGENT_DIRECTIVE', briefing('llm', 'AI headline') as unknown as Record<string, unknown>),
    ]
    const feed = buildFeed(evs, false)
    expect(feed.map((i) => i.kind)).toEqual(['briefing', 'event']) // keeps the first version's place
    const card = feed[0]
    if (card.kind === 'briefing') {
      expect(card.payload.headline).toBe('AI headline')
      expect(card.updated).toBe(true)
    }
  })

  it('finds the latest allocation', () => {
    const a = event('AGENT_ALLOCATION', { episode_id: 1 })
    const b = event('AGENT_ALLOCATION', { episode_id: 2 })
    expect(latestAllocation([a, event('X'), b, event('Y')])).toBe(b)
    expect(latestAllocation([])).toBeUndefined()
  })
})

describe('inventory bars', () => {
  it('puts the target first and reconstructs donor "before" as after + quantity', () => {
    const bars = inventoryBars(allocation, 'Greater Manchester')
    expect(bars.ppe_units.map((b) => b.role)).toEqual(['target', 'donor', 'donor'])
    expect(bars.ppe_units[0]).toMatchObject({ hub: 'Greater Manchester', before: 74900, after: 116000 })
    expect(bars.ppe_units[1]).toMatchObject({ hub: 'Cheshire', before: 32400 + 24300, after: 32400 })
    // conservation within the chart: what donors lost equals what the target gained
    for (const item of ['ppe_units', 'antiviral_doses', 'vaccine_doses'] as const) {
      const lost = bars[item].filter((b) => b.role === 'donor').reduce((s, b) => s + b.before - b.after, 0)
      expect(lost).toBe(bars[item][0].after - bars[item][0].before)
    }
  })
})

describe('behaviour', () => {
  it('polls faster while playing', () => {
    expect(pollInterval(true)).toBe(1000)
    expect(pollInterval(false)).toBe(3000)
  })

  it('falls back to offline tiles on early errors or a timeout, never after tiles load', () => {
    expect(shouldUseOffline({ errors: 3, loaded: 0, elapsedMs: 500 })).toBe(true)
    expect(shouldUseOffline({ errors: 0, loaded: 0, elapsedMs: 4000 })).toBe(true)
    expect(shouldUseOffline({ errors: 2, loaded: 0, elapsedMs: 1000 })).toBe(false)
    expect(shouldUseOffline({ errors: 9, loaded: 4, elapsedMs: 9000 })).toBe(false)
  })

  it('maps keys to shortcuts, but never while typing or with modifiers', () => {
    const key = (k: string, target: EventTarget | null = document.body, mods = {}) =>
      shortcutFor({ key: k, ctrlKey: false, metaKey: false, altKey: false, target, ...mods })
    expect(key(' ')).toBe('toggle')
    expect(key('ArrowRight')).toBe('step')
    expect(key('r')).toBe('reset')
    expect(key('S')).toBe('spike')
    expect(key('?')).toBe('help')
    expect(key('x')).toBeNull()
    expect(key('r', document.body, { metaKey: true })).toBeNull()
    for (const tag of ['input', 'textarea', 'select']) expect(key(' ', document.createElement(tag))).toBeNull()
  })

  it('finds the alert day and the day the current score crosses 80', () => {
    const days = [
      { date: '2026-09-30', status: 'ELEVATED', score: 55 },
      { date: '2026-10-02', status: 'CRITICAL', score: 64 },
      { date: '2026-10-03', status: 'CRITICAL', score: 78 },
      { date: '2026-10-04', status: 'CRITICAL', score: 86 },
    ]
    expect(leadMarkers(days, 80)).toEqual({ alert: '2026-10-02', cross: '2026-10-04' })
  })
})

describe('formatting', () => {
  it('formats dates, numbers and names for the projector', () => {
    expect(longDate('2026-10-02')).toBe('Fri 2 Oct 2026')
    expect(shortDate('2026-09-28')).toBe('28 Sep')
    expect(compact(24300)).toBe('24.3k')
    expect(compact(950)).toBe('950')
    expect(doublingDays(0.4)).toBeCloseTo(1.733, 3)
    expect(shortName('Bath and North East Somerset, Swindon and Wiltshire')).toBe('Bath')
    expect(shortName('Greater Manchester')).toBe('Greater Manchester')
  })
})

describe('arc labels', () => {
  it('sit on the side of the donor facing away from the target', async () => {
    const { labelOffset } = await import('../src/lib/geo')
    const target: [number, number] = [53.5, -2.25]
    expect(labelOffset([53.5, -1.6], target)).toBe('translate(18px, -50%)')               // donor to the east
    expect(labelOffset([53.5, -2.9], target)).toBe('translate(calc(-100% - 18px), -50%)') // west
    expect(labelOffset([54.0, -2.25], target)).toBe('translate(-50%, calc(-100% - 18px))') // north: above
    expect(labelOffset([53.0, -2.25], target)).toBe('translate(-50%, 18px)')              // south: below
  })
})
