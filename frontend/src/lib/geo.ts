export type LatLng = [number, number]

export const ENGLAND_BOUNDS: [LatLng, LatLng] = [[49.9, -6.0], [55.85, 1.9]]

/**
 * Curved arc from `from` to `to`: a quadratic Bezier whose control point sits off the
 * midpoint, perpendicular to the chord, by `bulge` x chord length. Longitude is scaled by
 * cos(latitude) first so the curve looks symmetric on the map. Returns n + 1 points
 * including both endpoints exactly.
 */
export function arcPoints(from: LatLng, to: LatLng, n = 32, bulge = 0.22): LatLng[] {
  const k = Math.cos((((from[0] + to[0]) / 2) * Math.PI) / 180)
  const [x0, y0] = [from[1] * k, from[0]]
  const [x2, y2] = [to[1] * k, to[0]]
  const [mx, my] = [(x0 + x2) / 2, (y0 + y2) / 2]
  const [dx, dy] = [x2 - x0, y2 - y0]
  // Perpendicular (rotate the chord 90 degrees anticlockwise), scaled by bulge.
  const [cx, cy] = [mx - dy * bulge, my + dx * bulge]
  const points: LatLng[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x2
    const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y2
    points.push([y, x / k])
  }
  points[0] = from
  points[n] = to
  return points
}

/**
 * Screen rotation (degrees clockwise, 0 = pointing right) of the arc's final segment, for
 * the arrowhead. Screen y grows downwards, hence the minus sign on latitude.
 */
export function arrowRotation(points: LatLng[]): number {
  const [a, b] = [points[points.length - 2], points[points.length - 1]]
  const k = Math.cos((b[0] * Math.PI) / 180)
  return (Math.atan2(-(b[0] - a[0]), (b[1] - a[1]) * k) * 180) / Math.PI
}

/** CSS translate placing a label beside the donor, on the side facing away from the target. */
export function labelOffset(donor: LatLng, target: LatLng, gapPx = 18): string {
  const k = Math.cos((donor[0] * Math.PI) / 180)
  const dx = (donor[1] - target[1]) * k
  const dy = -(donor[0] - target[0]) // screen y grows downwards
  const len = Math.hypot(dx, dy) || 1
  const [ux, uy] = [dx / len, dy / len]
  const x = ux > 0.35 ? `${gapPx}px` : ux < -0.35 ? `calc(-100% - ${gapPx}px)` : '-50%'
  const y = uy > 0.35 ? `${gapPx}px` : uy < -0.35 ? `calc(-100% - ${gapPx}px)` : '-50%'
  return `translate(${x}, ${y})`
}
