import { daysBetween } from './format'

export interface TimelineMarker {
  kind: 'spike' | 'alert' | 'hit'
  day: number
  label: string
}

export const MARKER_LABELS = { spike: 'Spike', alert: 'Alert raised', hit: 'Would have hit 80' } as const

/** Markers on the day track: spike injected, alert raised (first CRITICAL), score would have hit 80. */
export function timelineMarkers(firstDate: string, dates: { spike?: string; alert?: string; hit?: string }): TimelineMarker[] {
  const out: TimelineMarker[] = []
  for (const kind of ['spike', 'alert', 'hit'] as const) {
    const date = dates[kind]
    if (date) out.push({ kind, day: daysBetween(firstDate, date), label: MARKER_LABELS[kind] })
  }
  return out
}

/** Weekly tick days, skipping any within `gap` days of a marker or the cursor, so labels never overlap. */
export function tickDays(lastDay: number, avoid: number[], every = 7, gap = 2): number[] {
  const ticks: number[] = []
  for (let d = 0; d <= lastDay; d += every) {
    if (avoid.every((a) => Math.abs(a - d) > gap)) ticks.push(d)
  }
  return ticks
}

/** Place a label left or right of its anchor so it never runs off either end of the track. */
export function labelSide(fraction: number): 'left' | 'center' | 'right' {
  if (fraction > 0.88) return 'right'
  if (fraction < 0.06) return 'left'
  return 'center'
}
