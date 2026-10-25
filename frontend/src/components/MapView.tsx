import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Marker, Pane, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import 'leaflet/dist/leaflet.css'
import type { Zone } from '../api/types'
import { shouldUseOffline, TILE_TIMEOUT_MS } from '../lib/behaviour'
import { CITIES, ENGLAND_BOUNDS, MAX_BOUNDS, visibleCities, ZONE_LABEL_CHAR_PX, ZONE_LABEL_GAP_PX, zoneLabelSide, type LatLng } from '../lib/geo'
import { countByStatus, PIN_DOT_RADIUS, PIN_RING_RADIUS, PIN_SELECTED_RADIUS, STATUS_META } from '../lib/status'

/** 'vector': built-in outline (default, seam-free, offline). 'tiles': greyscale OSM at integer zoom. */
export type BaseMode = 'vector' | 'tiles'

interface Props {
  zones: Zone[]
  selected: string | null
  picking: boolean
  outline: FeatureCollection | null
  mode: BaseMode
  fellBack: boolean
  onFallBack: () => void
  onZoneClick: (zip: string) => void
}

// Leave room for the legend along the bottom edge.
const FIT: L.FitBoundsOptions = { paddingTopLeft: [20, 20], paddingBottomRight: [20, 56] }
// Closest zoom the + button allows: a single area fills the map, and tiles are still sharp.
const MAX_ZOOM = 10

export function MapView(p: Props) {
  const counts = countByStatus(p.zones.map((z) => z.status))
  return (
    <div className={`map-wrap map-${p.mode}${p.picking ? ' map-picking' : ''}`} data-testid="map">
      <MapContainer bounds={ENGLAND_BOUNDS} boundsOptions={FIT} zoomSnap={0.1} zoomControl={false}
                    attributionControl={false} className="map" maxBoundsViscosity={1} maxZoom={MAX_ZOOM}>
        <Fit mode={p.mode} />
        <ZoomControls />
        <Pane name="base" style={{ zIndex: 200 }} />
        <Pane name="cities" style={{ zIndex: 390 }} />
        <Pane name="labels" style={{ zIndex: 650 }} />
        {p.mode === 'vector'
          ? p.outline && <GeoJSON data={p.outline} style={outlineStyle} interactive={false} pane="base" />
          : <Tiles onFallBack={p.onFallBack} />}
        {p.mode === 'vector' && <Cities zones={p.zones} />}
        {p.zones.map((z) => (
          <Pin key={z.zip_code} zone={z} selected={p.selected === z.zip_code} onClick={p.onZoneClick} />
        ))}
        <ZoneLabels zones={p.zones} selected={p.selected} />
      </MapContainer>

      <div className="map-legend" data-testid="legend">
        {(['CRITICAL', 'ELEVATED', 'SAFE'] as const).map((s) => (
          <span key={s} className="legend-item">
            <span className="legend-pin" data-status={s} />
            {STATUS_META[s].label} <strong>{counts[s]}</strong>
          </span>
        ))}
      </div>
      <div className="map-attrib">{p.mode === 'tiles' ? '© OpenStreetMap contributors' : 'Outline: Natural Earth'}</div>
      {p.fellBack && <div className="map-chip" data-testid="offline-banner">Offline: using the built-in map</div>}
      {p.picking && <div className="map-hint">Click an area to choose it for the spike</div>}
    </div>
  )
}

/** Land colours come from CSS (.base-shape), so they follow the light/dark theme. */
function outlineStyle(feature?: GeoJSON.Feature) {
  const england = feature?.properties?.role === 'england'
  return { className: england ? 'base-shape base-england' : 'base-shape', weight: england ? 1.2 : 1, fillOpacity: 1 }
}

/**
 * Zoom in / out / back to England. Steps are whole zoom levels, so tiles mode stays on
 * integer zoom (no tile seams). Clicks and scrolls on the buttons don't reach the map.
 */
function ZoomControls() {
  const map = useMap()
  const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(() => map.getZoom())
  // Leaflet ignores setZoom while a zoom animation runs, so quick clicks would be lost:
  // remember where the buttons are heading and finish the move when the animation ends.
  const target = useRef<number | null>(null)
  useMapEvents({
    zoomend: () => {
      setZoom(map.getZoom())
      if (target.current !== null && Math.abs(map.getZoom() - target.current) > 0.01) map.setZoom(target.current)
      else target.current = null
    },
  })
  useEffect(() => {
    if (!box.current) return
    L.DomEvent.disableClickPropagation(box.current)
    L.DomEvent.disableScrollPropagation(box.current)
  }, [])
  const step = (delta: number) => {
    const from = target.current ?? map.getZoom()
    target.current = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), Math.round(from) + delta))
    map.setZoom(target.current)
  }
  return (
    <div className="zoom-controls" ref={box} role="group" aria-label="Map zoom" data-testid="zoom-controls">
      <button onClick={() => step(1)} disabled={zoom >= map.getMaxZoom()} aria-label="Zoom in" title="Zoom in"
              data-testid="zoom-in">+</button>
      <button onClick={() => step(-1)} disabled={zoom <= map.getMinZoom() + 0.01} aria-label="Zoom out" title="Zoom out"
              data-testid="zoom-out">−</button>
      <button onClick={() => map.flyToBounds(ENGLAND_BOUNDS, { ...FIT, duration: 0.8 })} aria-label="Show all of England"
              title="Show all of England" data-testid="zoom-fit">⤢</button>
    </div>
  )
}

/**
 * Fit England tightly and stop panning/zooming far from it. In tiles mode the zoom snaps to
 * whole levels: at fractional zoom browsers scale each tile separately and leave hairline seams.
 */
function Fit({ mode }: { mode: BaseMode }) {
  const map = useMap()
  useEffect(() => {
    const fit = () => {
      L.Util.setOptions(map, { zoomSnap: mode === 'tiles' ? 1 : 0.1 })
      map.setMinZoom(0)
      map.invalidateSize()
      map.fitBounds(ENGLAND_BOUNDS, { ...FIT, animate: false })
      const fitZoom = map.getBoundsZoom(ENGLAND_BOUNDS, false, L.point(40, 76))
      map.setMinZoom(mode === 'tiles' ? Math.floor(fitZoom) : fitZoom - 0.4)
      map.setMaxBounds(MAX_BOUNDS)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map, mode])
  return null
}

/** Greyscale OSM tiles (CSS filter), falling back to the built-in map if they fail to load. */
function Tiles({ onFallBack }: { onFallBack: () => void }) {
  const tile = useRef({ errors: 0, loaded: 0, start: Date.now() })
  const done = useRef(false)
  const layer = useRef<L.TileLayer>(null)
  const check = () => {
    if (done.current) return
    if (shouldUseOffline({ ...tile.current, elapsedMs: Date.now() - tile.current.start })) {
      done.current = true
      onFallBack()
    }
  }
  useEffect(() => {
    tile.current = { errors: 0, loaded: 0, start: Date.now() }
    const timer = window.setTimeout(check, TILE_TIMEOUT_MS + 50)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <TileLayer ref={layer} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" className="basemap-tiles"
      eventHandlers={{
        tileerror: () => { tile.current.errors += 1; check() },
        tileload: () => { tile.current.loaded += 1 },
        // Once the current level has loaded, drop leftover tiles from other zoom levels.
        load: () => (layer.current as unknown as { _pruneTiles?: () => void } | null)?._pruneTiles?.(),
      }} />
  )
}

/** A few city names for orientation, hidden wherever they would sit on top of a pin. */
function Cities({ zones }: { zones: Zone[] }) {
  const map = useMap()
  const [version, setVersion] = useState(0)
  useMapEvents({
    zoomend: () => setVersion((v) => v + 1), moveend: () => setVersion((v) => v + 1),
    resize: () => setVersion((v) => v + 1),
  })
  const shown = useMemo(() => {
    const pins = zones.map((z) => map.latLngToContainerPoint([z.latitude, z.longitude]))
    return visibleCities(CITIES, (ll) => map.latLngToContainerPoint(ll), pins)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, zones.length, map])
  const icons = useMemo(() => new Map(CITIES.map((c) => [c.name, L.divIcon({
    className: '', iconSize: [0, 0], html: `<div class="city-label">${c.name}</div>`,
  })])), [])
  return (
    <>
      {shown.map((c) => (
        <Marker key={c.name} position={[c.lat, c.lon]} icon={icons.get(c.name)!} interactive={false} pane="cities" />
      ))}
    </>
  )
}

/**
 * One area: a small dot inside a thin ring. Colours come from CSS via data-status, so a
 * change of state eases over 600 ms instead of jumping. CRITICAL adds an outward pulse.
 */
function Pin({ zone, selected, onClick }: { zone: Zone; selected: boolean; onClick: (zip: string) => void }) {
  const map = useMap()
  const ring = useRef<L.CircleMarker>(null)
  const dot = useRef<L.CircleMarker>(null)
  const tooltip = useRef<L.Tooltip>(null)
  const center: LatLng = [zone.latitude, zone.longitude]
  useEffect(() => {
    for (const layer of [ring.current, dot.current]) {
      const el = layer?.getElement()
      if (!el) continue
      el.setAttribute('data-status', zone.status)
      el.setAttribute('data-zone', zone.zip_code)
      el.toggleAttribute('data-selected', selected)
    }
  }, [zone.status, zone.zip_code, selected])
  return (
    <>
      {zone.status === 'CRITICAL' && (
        <CircleMarker center={center} radius={PIN_RING_RADIUS} interactive={false}
                      pathOptions={{ className: 'pin-pulse', fill: false, weight: 2 }} />
      )}
      {selected && (
        <CircleMarker center={center} radius={PIN_SELECTED_RADIUS} interactive={false}
                      pathOptions={{ className: 'pin-selected', fill: false, weight: 2 }} />
      )}
      <CircleMarker ref={ring} center={center} radius={PIN_RING_RADIUS}
                    pathOptions={{ className: 'pin-ring', weight: 2, fillOpacity: 0.92 }}
                    eventHandlers={{
                      click: () => onClick(zone.zip_code),
                      tooltipopen: () => {
                        const tip = tooltip.current
                        const bounds = tip?.getElement()?.getBoundingClientRect()
                        if (!tip || !bounds) return
                        const mapBounds = map.getContainer().getBoundingClientRect()
                        const left = Math.max(8, mapBounds.left + 8)
                        const right = Math.min(window.innerWidth - 8, mapBounds.right - 8)
                        const top = Math.max(8, mapBounds.top + 8)
                        const bottom = Math.min(window.innerHeight - 8, mapBounds.bottom - 8)
                        const dx = Math.max(left, Math.min(bounds.left, right - bounds.width)) - bounds.left
                        const dy = Math.max(top, Math.min(bounds.top, bottom - bounds.height)) - bounds.top
                        if (dx || dy) {
                          tip.options.offset = L.point(tip.options.offset ?? [0, 0]).add([dx, dy])
                          tip.update()
                        }
                      },
                    }}>
        {/* Small screens pin only the selection; other critical names remain available on hover. */}
        {!selected && (
          <Tooltip ref={tooltip} direction="auto" offset={[10, 0]}
                   className={`zone-label${zone.status === 'CRITICAL' ? ' zone-label-compact' : ''}`}>
            {zone.zone_name} · {STATUS_META[zone.status].label}
          </Tooltip>
        )}
      </CircleMarker>
      <CircleMarker ref={dot} center={center} radius={PIN_DOT_RADIUS} interactive={false}
                    pathOptions={{ className: 'pin-dot', stroke: false, fillOpacity: 1 }} />
    </>
  )
}

/**
 * Names for CRITICAL and selected areas, as non-interactive markers in their own pane.
 * (Leaflet's permanent tooltips can be dropped during a camera flight; markers can't.)
 */
function ZoneLabels({ zones, selected }: { zones: Zone[]; selected: string | null }) {
  const map = useMap()
  const [version, setVersion] = useState(0)
  useMapEvents({ zoomend: () => setVersion((v) => v + 1), moveend: () => setVersion((v) => v + 1) })
  const labelled = zones.filter((z) => z.status === 'CRITICAL' || z.zip_code === selected)
  const statuses = zones.map((z) => z.status).join(',')
  const items = useMemo(() => {
    const points = zones.map((z) => ({ zip: z.zip_code, important: z.status !== 'SAFE',
                                       ...map.latLngToContainerPoint([z.latitude, z.longitude]) }))
    return labelled.map((z) => {
      const here = points.find((q) => q.zip === z.zip_code)!
      let side = zoneLabelSide(z.zone_name, here, points.filter((q) => q.zip !== z.zip_code))
      const room = {
        left: here.x - ZONE_LABEL_GAP_PX - 8,
        right: map.getSize().x - here.x - ZONE_LABEL_GAP_PX - 8,
      }
      const opposite = side === 'left' ? 'right' : 'left'
      const labelWidth = Math.min(240, z.zone_name.length * ZONE_LABEL_CHAR_PX + 16)
      if (room[side] < labelWidth && room[opposite] > room[side]) side = opposite
      const maxWidth = Math.max(0, Math.min(240, room[side]))
      return {
        key: `${z.zip_code}-${z.status}-${side}`, at: [z.latitude, z.longitude] as LatLng,
        icon: L.divIcon({ className: '', iconSize: [0, 0], html:
          `<div class="zone-label zone-label-pinned side-${side}${z.status === 'CRITICAL' ? ' zone-label-critical' : ''}" ` +
          `style="max-width:${maxWidth}px" data-zone="${z.zip_code}"${z.zip_code === selected ? ' data-selected' : ''}>${escapeHtml(z.zone_name)}</div>` }),
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, statuses, selected, map])
  return (
    <>
      {items.map((it) => <Marker key={it.key} position={it.at} icon={it.icon} interactive={false} pane="labels" />)}
    </>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
