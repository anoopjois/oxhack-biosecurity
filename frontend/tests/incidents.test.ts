// Layer A: incident grouping, timeline markers and map label collisions.
import { describe, expect, it } from 'vitest'
import { buildIncidents, focusZip, phaseOf } from '../src/lib/incidents'
import { CITIES, cityLabelBox, visibleCities } from '../src/lib/geo'
import { labelSide, tickDays, timelineMarkers } from '../src/lib/timeline'
import { event } from './fixtures'

const GM = 'greater-manchester'
const DV = 'devon'
const inject = (zip: string, date: string) => event('OUTBREAK_INJECTED', { r: 0.4, start_day: 27 }, { zip_code: zip, sim_date: date })
const critical = (zip: string, date: string) => event('STATUS_CHANGE', { from: 'ELEVATED', to: 'CRITICAL', projected_score: 83, doubling_days: 2.1 }, { zip_code: zip, sim_date: date })
const opened = (zip: string, episode: number) => event('INCIDENT_OPENED',
  { episode_id: episode, summary: 'Critical forecast', recipient: 'test@example.com', status: 'awaiting_approval' }, { zip_code: zip })
const report = (zip: string, episode: number, status: string) =>
  event('REPORT_STATUS', { episode_id: episode, status }, { zip_code: zip })
const closed = (zip: string) => event('STATUS_CHANGE', { from: 'CRITICAL', to: 'ELEVATED' }, { zip_code: zip })

describe('incidents', () => {
  it('routes interleaved report progress to the correct episode', () => {
    const incidents = buildIncidents([
      critical(GM, '2026-10-02'), opened(GM, 1), critical(DV, '2026-10-02'), opened(DV, 2),
      report(DV, 2, 'failed'), report(GM, 1, 'sent'),
    ])
    const byZip = new Map(incidents.map((i) => [i.zip, i]))
    expect(byZip.get(GM)?.report?.status).toBe('sent')
    expect(byZip.get(DV)?.report?.status).toBe('failed')
  })

  it('opens a card only when detected, never for synthetic injection', () => {
    const steps = [inject(GM, '2026-09-28'), critical(GM, '2026-10-02'), opened(GM, 1)]
    expect(buildIncidents(steps.slice(0, 1))).toEqual([])
    const [incident] = buildIncidents(steps)
    expect(incident.zip).toBe(GM)
    expect(incident.detected).toBeDefined()
    expect(incident.opened?.status).toBe('awaiting_approval')
    expect(phaseOf(incident)).toBe('critical')
  })

  it('keeps simultaneous outbreaks apart, even when their events interleave', () => {
    const events = [
      inject(GM, '2026-09-28'), inject(DV, '2026-09-28'),
      critical(DV, '2026-10-01'), opened(DV, 1), critical(GM, '2026-10-02'),
      opened(GM, 2), report(DV, 1, 'sent'), report(GM, 2, 'sending'),
    ]
    const incidents = buildIncidents(events)
    expect(incidents.map((i) => i.zip)).toEqual([GM, DV])
    for (const i of incidents) {
      expect(i.detected.zip_code).toBe(i.zip)
    }
    expect(incidents.find((i) => i.zip === GM)!.episodeId).toBe(2)
  })

  it('closes on CRITICAL exit while keeping late report results attached', () => {
    const [incident] = buildIncidents([
      critical(GM, '2026-10-02'), opened(GM, 1), closed(GM), report(GM, 1, 'sent'),
    ])
    expect(incident.report?.status).toBe('sent')
    expect(phaseOf(incident)).toBe('closed')
  })

  it('opens a new card when a closed zone goes critical again', () => {
    const incidents = buildIncidents([
      critical(GM, '2026-10-02'), opened(GM, 1), closed(GM), critical(GM, '2026-10-08'), opened(GM, 2),
    ])
    expect(incidents).toHaveLength(2)
    expect(focusZip(incidents)).toBe(GM)
    expect(phaseOf(incidents[0])).toBe('critical')
    expect(phaseOf(incidents[1])).toBe('closed')
  })
})

describe('timeline', () => {
  it('places spike, alert and would-hit-80 markers by day', () => {
    expect(timelineMarkers('2026-09-01', { spike: '2026-09-28', alert: '2026-10-02', hit: '2026-10-04' }))
      .toEqual([
        { kind: 'spike', day: 27, label: 'Spike' },
        { kind: 'alert', day: 31, label: 'Alert raised' },
        { kind: 'hit', day: 33, label: 'Would have hit 80' },
      ])
    expect(timelineMarkers('2026-09-01', {})).toEqual([])
  })

  it('drops week ticks that would collide with markers or the cursor', () => {
    expect(tickDays(41, [])).toEqual([0, 7, 14, 21, 28, 35])
    expect(tickDays(41, [27, 31])).toEqual([0, 7, 14, 21, 35])
  })

  it('keeps the cursor label on the track at both ends', () => {
    expect(labelSide(1)).toBe('right')
    expect(labelSide(0)).toBe('left')
    expect(labelSide(0.6)).toBe('center')
  })
})

describe('city labels', () => {
  const at = (x: number, y: number) => () => ({ x, y })

  it('hides a city whose label box would sit on a pin, or on another label', () => {
    const london = CITIES.find((c) => c.name === 'London')!
    expect(visibleCities([london], at(100, 100), [{ x: 300, y: 300 }])).toEqual([london])
    expect(visibleCities([london], at(100, 100), [{ x: 104, y: 112 }])).toEqual([])  // pin under the label
    const box = cityLabelBox('London', { x: 100, y: 100 })
    expect(visibleCities([london], at(100, 100), [{ x: box.x1 + 20, y: box.y0 }])).toEqual([london])
    const twins = [london, { ...london, name: 'Londinium' }]
    expect(visibleCities(twins, at(100, 100), [])).toHaveLength(1)
  })
})

describe('pinned zone labels', () => {
  it('move to the left when the right side would cover an elevated or critical pin', async () => {
    const { zoneLabelSide } = await import('../src/lib/geo')
    const here = { x: 400, y: 300 }
    expect(zoneLabelSide('Greater Manchester', here, [])).toBe('right')
    expect(zoneLabelSide('Greater Manchester', here, [{ x: 470, y: 305, important: true }])).toBe('left')
    // a normal pin on the right is outweighed by an important one on the left
    expect(zoneLabelSide('Greater Manchester', here, [{ x: 470, y: 300, important: false },
                                                      { x: 330, y: 300, important: true }])).toBe('right')
  })
})
