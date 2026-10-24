import type { Priority, Status } from '../api/types'

// Fixed status palette (dataviz reference); always paired with a text label.
export const STATUS_META: Record<Status, { label: string; color: string; ink: string; order: number }> = {
  CRITICAL: { label: 'Critical', color: '#d03b3b', ink: '#ffffff', order: 0 },
  ELEVATED: { label: 'Elevated', color: '#fab219', ink: '#1a1a1a', order: 1 },
  SAFE: { label: 'Safe', color: '#0ca30c', ink: '#ffffff', order: 2 },
  INSUFFICIENT_DATA: { label: 'No data', color: '#898781', ink: '#ffffff', order: 3 },
}

export const STATUSES: Status[] = ['CRITICAL', 'ELEVATED', 'SAFE', 'INSUFFICIENT_DATA']

export const PRIORITY_META: Record<Priority, { label: string; color: string; ink: string }> = {
  immediate: { label: 'Immediate', color: '#d03b3b', ink: '#ffffff' },
  '24h': { label: '24h', color: '#fab219', ink: '#1a1a1a' },
  '72h': { label: '72h', color: '#475569', ink: '#ffffff' },
}

export const SERIES = { current: '#2a78d6', projected: '#eb6834', before: '#a8a69f', after: '#2a78d6' }

export const PIN_MIN_RADIUS = 7
export const PIN_RADIUS_RANGE = 14

/** Pin radius grows with sqrt(population), so pin AREA is proportional to population. */
export function pinRadius(population: number, maxPopulation: number): number {
  const share = maxPopulation > 0 ? Math.min(1, Math.max(0, population / maxPopulation)) : 0
  return PIN_MIN_RADIUS + PIN_RADIUS_RANGE * Math.sqrt(share)
}

export function countByStatus(statuses: Status[]): Record<Status, number> {
  const counts: Record<Status, number> = { CRITICAL: 0, ELEVATED: 0, SAFE: 0, INSUFFICIENT_DATA: 0 }
  for (const s of statuses) counts[s] += 1
  return counts
}
