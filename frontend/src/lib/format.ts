const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "2026-10-02" -> "Fri 2 Oct 2026" */
export function longDate(iso: string): string {
  const d = parseIso(iso)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "2026-10-02" -> "2 Oct" */
export function shortDate(iso: string): string {
  const d = parseIso(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIso(toIso).getTime() - parseIso(fromIso).getTime()) / 86_400_000)
}

/** The last day index of the run (41), from the clock's date range. */
export const lastDay = (clock: { first_date: string; last_date: string }) => daysBetween(clock.first_date, clock.last_date)

/** 61588 -> "61,588" */
export const int = (n: number) => Math.round(n).toLocaleString('en-GB')

/** 116000 -> "116k", 24300 -> "24k", 4300 -> "4.3k", 950 -> "950" */
export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1_000)}k`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

/**
 * Round parts to whole numbers that still add up to the rounded total (largest remainder),
 * so displayed points never disagree with the displayed score: [49.9, 22.7, 3.6] -> [50, 23, 3].
 */
export function roundToTotal(parts: number[]): number[] {
  const target = Math.round(parts.reduce((sum, p) => sum + p, 0))
  const rounded = parts.map(Math.floor)
  const deficit = target - rounded.reduce((sum, p) => sum + p, 0)
  const order = parts.map((p, i) => ({ i, rest: p - Math.floor(p) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (let k = 0; k < deficit; k++) rounded[order[k % order.length].i] += 1
  return rounded
}

export const score = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(1))

/** Doubling time ln2 / r, in days. */
export const doublingDays = (r: number) => Math.log(2) / r

/** "Bath and North East Somerset, Swindon and Wiltshire" -> "Bath"; keeps short names whole. */
export function shortName(name: string): string {
  return name.split(/,| and /)[0].trim()
}
