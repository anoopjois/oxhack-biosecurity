// Layer A: pure logic.
import { describe, expect, it } from 'vitest'
import { leadMarkers, pollInterval, shortcutFor, shouldUseOffline } from '../src/lib/behaviour'
import { buildFeed, isDefaultVisible } from '../src/lib/events'
import { compact, doublingDays, longDate, roundToTotal, shortDate } from '../src/lib/format'
import { countByStatus, PIN_DOT_RADIUS, PIN_RING_RADIUS, PIN_SELECTED_RADIUS, RISK_SCORE_HELP, STATUS_META } from '../src/lib/status'
import { event } from './fixtures'

describe('status and pins', () => {
  it('maps every status to a colour and a text label', () => {
    expect(STATUS_META.CRITICAL).toMatchObject({ label: 'Critical', color: '#d03b3b' })
    expect(STATUS_META.ELEVATED.ink).toBe('#2b1d00') // dark text on amber for contrast
    expect(STATUS_META.SAFE.label).toBe('Normal')      // plain language for a lay audience
    expect(countByStatus(['SAFE', 'SAFE', 'CRITICAL'])).toEqual({ CRITICAL: 1, ELEVATED: 0, SAFE: 2, INSUFFICIENT_DATA: 0 })
  })

  it('keeps pins small and the same size: dot inside ring inside selection ring', () => {
    expect(PIN_DOT_RADIUS * 2).toBeGreaterThanOrEqual(6)
    expect(PIN_DOT_RADIUS * 2).toBeLessThanOrEqual(8)
    expect(PIN_RING_RADIUS * 2).toBeGreaterThanOrEqual(14)
    expect(PIN_RING_RADIUS * 2).toBeLessThanOrEqual(18)
    expect(PIN_SELECTED_RADIUS).toBeGreaterThan(PIN_RING_RADIUS)
  })

  it('explains the viral outbreak index, its factors and alert rules without implying a diagnosis', () => {
    expect(RISK_SCORE_HELP).toMatch(/0–100/)
    expect(RISK_SCORE_HELP).toMatch(/Wastewater viral load \(50%\).*A&E waiting-time pressure \(35%\).*Mobility & crowding \(15%\)/)
    expect(RISK_SCORE_HELP).toContain('not an infection probability')
    expect(RISK_SCORE_HELP).toContain('at least 80')
  })
})

describe('event feed', () => {
  it('default filter includes detected incidents and report progress', () => {
    expect(isDefaultVisible(event('OUTBREAK_INJECTED'))).toBe(true)
    expect(isDefaultVisible(event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL' }))).toBe(true)
    expect(isDefaultVisible(event('STATUS_CHANGE', { from: 'SAFE', to: 'ELEVATED' }))).toBe(false)
    expect(isDefaultVisible(event('STATUS_CHANGE', { from: 'CRITICAL', to: 'ELEVATED' }))).toBe(false)
    for (const t of ['INCIDENT_OPENED', 'INCIDENT_DECISION', 'REPORT_STATUS', 'TIMELINE_END']) {
      expect(isDefaultVisible(event(t))).toBe(true)
    }
  })

  it('shows everything with "show all": newest day first, chronological within a day', () => {
    const evs = [
      event('OUTBREAK_INJECTED', {}, { sim_date: '2026-09-28' }),
      event('STATUS_CHANGE', { from: 'SAFE', to: 'ELEVATED' }, { sim_date: '2026-09-30' }),
      event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL' }, { sim_date: '2026-10-02' }),
      event('INCIDENT_OPENED', {}, { sim_date: '2026-10-02' }),
      event('REPORT_STATUS', {}, { sim_date: '2026-10-02' }),
    ]
    expect(buildFeed(evs, false)).toHaveLength(4)
    expect(buildFeed(evs, true).map((i) => [i.date, i.event.type])).toEqual([
      ['2026-10-02', 'STATUS_CHANGE'], ['2026-10-02', 'INCIDENT_OPENED'], ['2026-10-02', 'REPORT_STATUS'],
      ['2026-09-30', 'STATUS_CHANGE'], ['2026-09-28', 'OUTBREAK_INJECTED'],
    ])
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
  it('rounds factor points so they add up to the rounded score', () => {
    expect(roundToTotal([49.9, 22.7, 3.6])).toEqual([50, 23, 3])
    expect(roundToTotal([6, 5, 9])).toEqual([6, 5, 9])
    expect(roundToTotal([5.96, 4.17, 9])).toEqual([6, 4, 9])
    expect(roundToTotal([33.4, 33.4, 33.2])).toEqual([34, 33, 33])
    for (const parts of [[0.4, 0.4, 0.4], [12.5, 12.5, 0], [49.99, 34.99, 14.99]]) {
      expect(roundToTotal(parts).reduce((a, b) => a + b, 0)).toBe(Math.round(parts.reduce((a, b) => a + b, 0)))
    }
  })
  it('formats dates, numbers and names for the projector', () => {
    expect(longDate('2026-10-02')).toBe('Fri 2 Oct 2026')
    expect(shortDate('2026-09-28')).toBe('28 Sep')
    expect(compact(24300)).toBe('24k')
    expect(compact(116000)).toBe('116k')
    expect(compact(4300)).toBe('4.3k')
    expect(compact(950)).toBe('950')
    expect(doublingDays(0.4)).toBeCloseTo(1.733, 3)
  })
})
