export type LatLng = [number, number]

export const ENGLAND_BOUNDS: [LatLng, LatLng] = [[49.95, -5.8], [55.82, 1.78]]
/** Panning stops here: England plus a margin, so the view never drifts off to Europe. */
export const MAX_BOUNDS: [LatLng, LatLng] = [[48.6, -9.0], [57.2, 4.8]]

export interface City { name: string; lat: number; lon: number }

/** Orientation labels for the built-in map (approximate city centres). */
export const CITIES: City[] = [
  { name: 'London', lat: 51.507, lon: -0.128 }, { name: 'Birmingham', lat: 52.486, lon: -1.89 },
  { name: 'Manchester', lat: 53.481, lon: -2.242 }, { name: 'Leeds', lat: 53.8, lon: -1.549 },
  { name: 'Liverpool', lat: 53.408, lon: -2.991 }, { name: 'Newcastle', lat: 54.978, lon: -1.618 },
  { name: 'Bristol', lat: 51.455, lon: -2.588 }, { name: 'Sheffield', lat: 53.381, lon: -1.47 },
  { name: 'Nottingham', lat: 52.954, lon: -1.158 }, { name: 'Southampton', lat: 50.91, lon: -1.404 },
  { name: 'Norwich', lat: 52.63, lon: 1.297 }, { name: 'Plymouth', lat: 50.376, lon: -4.143 },
  { name: 'Cambridge', lat: 52.205, lon: 0.122 }, { name: 'York', lat: 53.96, lon: -1.087 },
  { name: 'Exeter', lat: 50.718, lon: -3.534 }, { name: 'Hull', lat: 53.745, lon: -0.337 },
  { name: 'Carlisle', lat: 54.892, lon: -2.934 },
]

export const CITY_CHAR_PX = 6.6   // approximate width of one 11px label character
export const PIN_CLEARANCE_PX = 14 // the selection ring's radius (12.5 px) plus a little air

interface Box { x0: number; x1: number; y0: number; y1: number }

/** The screen box of a city label, drawn centred just below the city point. */
export function cityLabelBox(name: string, p: { x: number; y: number }): Box {
  const half = (name.length * CITY_CHAR_PX) / 2
  return { x0: p.x - half, x1: p.x + half, y0: p.y + 5, y1: p.y + 19 } // matches .city-label's 5px offset
}

/** Cities whose label box stays clear of every pin ring and of every other kept label. */
export function visibleCities(cities: City[], toPoint: (ll: LatLng) => { x: number; y: number },
                              pins: { x: number; y: number }[], clearance = PIN_CLEARANCE_PX): City[] {
  const kept: Box[] = []
  return cities.filter((c) => {
    const box = cityLabelBox(c.name, toPoint([c.lat, c.lon]))
    const hitsPin = pins.some((q) => q.x > box.x0 - clearance && q.x < box.x1 + clearance
                                  && q.y > box.y0 - clearance && q.y < box.y1 + clearance)
    const hitsLabel = kept.some((k) => box.x0 < k.x1 && box.x1 > k.x0 && box.y0 < k.y1 && box.y1 > k.y0)
    if (hitsPin || hitsLabel) return false
    kept.push(box)
    return true
  })
}

export const ZONE_LABEL_CHAR_PX = 7.6 // approximate width of one 0.85rem bold label character
export const ZONE_LABEL_GAP_PX = 14

/**
 * Which side of its pin a pinned zone label should sit: the side covering fewer other pins,
 * where covering an ELEVATED/CRITICAL pin counts ten times as much as covering a normal one.
 */
export function zoneLabelSide(name: string, p: { x: number; y: number },
                              others: { x: number; y: number; important: boolean }[]): 'right' | 'left' {
  const width = name.length * ZONE_LABEL_CHAR_PX + 16
  const cost = (x0: number, x1: number) => others.reduce((sum, q) =>
    q.x > x0 - PIN_CLEARANCE_PX && q.x < x1 + PIN_CLEARANCE_PX && Math.abs(q.y - p.y) < 11 + PIN_CLEARANCE_PX
      ? sum + (q.important ? 10 : 1) : sum, 0)
  const right = cost(p.x + ZONE_LABEL_GAP_PX, p.x + ZONE_LABEL_GAP_PX + width)
  const left = cost(p.x - ZONE_LABEL_GAP_PX - width, p.x - ZONE_LABEL_GAP_PX)
  return left < right ? 'left' : 'right'
}
