import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import 'leaflet/dist/leaflet.css'
import type { AllocationPayload, Zone } from '../api/types'
import { shouldUseOffline, TILE_TIMEOUT_MS } from '../lib/behaviour'
import { compact, shortName } from '../lib/format'
import { arcPoints, arrowRotation, ENGLAND_BOUNDS, labelOffset, type LatLng } from '../lib/geo'
import { countByStatus, pinRadius, STATUS_META, STATUSES } from '../lib/status'

export type BaseMode = 'online' | 'offline'

export interface ArcSet {
  key: number
  allocations: AllocationPayload[]
}

interface Props {
  zones: Zone[]
  selected: string | null
  picking: boolean
  arcs: ArcSet | null
  outline: FeatureCollection | null
  mode: BaseMode
  fellBack: boolean
  onMode: (mode: BaseMode) => void
  onFallBack: () => void
  onZoneClick: (zip: string) => void
}

export function MapView(p: Props) {
  const offline = p.mode === 'offline'
  const counts = countByStatus(p.zones.map((z) => z.status))
  return (
    <div className={`map-wrap${offline ? ' map-offline' : ''}${p.picking ? ' map-picking' : ''}`} data-testid="map">
      <MapContainer bounds={ENGLAND_BOUNDS} zoomSnap={0.1} zoomControl={false} attributionControl={!offline}
                    className="map" preferCanvas={false}>
        <FitOnResize focused={p.arcs !== null} />
        <Camera arcs={p.arcs} zones={p.zones} />
        {offline ? (
          p.outline && <GeoJSON data={p.outline} style={outlineStyle} interactive={false} />
        ) : (
          <TileWatcher onFallBack={p.onFallBack} />
        )}
        <Pins zones={p.zones} selected={p.selected} onZoneClick={p.onZoneClick} />
        {p.arcs && <Arcs arcs={p.arcs} zones={p.zones} />}
      </MapContainer>

      <div className="map-legend" data-testid="legend">
        {STATUSES.filter((s) => s !== 'INSUFFICIENT_DATA' || counts[s] > 0).map((s) => (
          <span key={s} className="legend-item">
            <span className={`legend-dot${s === 'CRITICAL' ? ' legend-dot-critical' : ''}`}
                  style={{ background: STATUS_META[s].color }} />
            {STATUS_META[s].label} <strong>{counts[s]}</strong>
          </span>
        ))}
        <span className="legend-note">Pin size = population</span>
      </div>

      <div className="map-mode segmented" role="group" aria-label="Base map">
        <span className="seg-caption">Map</span>
        {(['online', 'offline'] as BaseMode[]).map((m) => (
          <button key={m} className={`seg${p.mode === m ? ' seg-on' : ''}`} aria-pressed={p.mode === m}
                  onClick={() => p.onMode(m)} data-testid={`map-${m}`}>
            {m === 'online' ? 'Online' : 'Offline'}
          </button>
        ))}
      </div>

      {p.picking && <div className="map-banner map-banner-pick">Click a zone to choose it for the spike</div>}
      {offline && p.fellBack && (
        <div className="map-banner" data-testid="offline-banner">Map tiles unavailable: using offline outline</div>
      )}
    </div>
  )
}

function outlineStyle(feature?: GeoJSON.Feature) {
  const england = feature?.properties?.role === 'england'
  return {
    className: england ? 'offline-outline offline-england' : 'offline-outline',
    color: england ? '#5f5e58' : '#b8b6ae',
    weight: england ? 1.5 : 1,
    fillColor: england ? '#f6f5f0' : '#ebeae4',
    fillOpacity: 1,
  }
}

/** OSM tiles, falling back to the offline outline if they fail before any has loaded. */
function TileWatcher({ onFallBack }: { onFallBack: () => void }) {
  const tile = useRef({ errors: 0, loaded: 0, start: Date.now() })
  const done = useRef(false)
  const check = () => {
    if (done.current) return
    const elapsedMs = Date.now() - tile.current.start
    if (shouldUseOffline({ ...tile.current, elapsedMs })) {
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
    <TileLayer
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      eventHandlers={{
        tileerror: () => { tile.current.errors += 1; check() },
        tileload: () => { tile.current.loaded += 1 },
      }}
    />
  )
}

function FitOnResize({ focused }: { focused: boolean }) {
  const map = useMap()
  const focusedRef = useRef(focused)
  useEffect(() => { focusedRef.current = focused }, [focused])
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
      if (!focusedRef.current) map.fitBounds(ENGLAND_BOUNDS)
    })
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  return null
}

const FOCUS_PADDING: [number, number] = [150, 110]
const FOCUS_MAX_ZOOM = 8

/** When stock moves, fly to the target and its donors; fly back to England when the arcs clear. */
function Camera({ arcs, zones }: { arcs: ArcSet | null; zones: Zone[] }) {
  const map = useMap()
  const key = arcs?.key ?? null
  useEffect(() => {
    if (!arcs) {
      map.flyToBounds(ENGLAND_BOUNDS, { duration: 1.0 })
      return
    }
    const byZip = new Map(zones.map((z) => [z.zip_code, z]))
    const points = arcs.allocations.flatMap((a) => [a.target, ...a.transfers.map((t) => t.donor)])
      .map((zip) => byZip.get(zip)).filter((z): z is Zone => z !== undefined)
      .map((z) => [z.latitude, z.longitude] as LatLng)
    if (points.length > 1) {
      map.flyToBounds(L.latLngBounds(points), { padding: FOCUS_PADDING, maxZoom: FOCUS_MAX_ZOOM, duration: 1.2 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
}

function Pins({ zones, selected, onZoneClick }: { zones: Zone[]; selected: string | null; onZoneClick: (z: string) => void }) {
  const maxPop = Math.max(...zones.map((z) => z.population), 1)
  // Big pins first so small ones stay visible; non-SAFE zones on top.
  const ordered = [...zones].sort((a, b) =>
    STATUS_META[b.status].order - STATUS_META[a.status].order || b.population - a.population)
  return (
    <>
      {ordered.map((z) => {
        const r = pinRadius(z.population, maxPop)
        const center: LatLng = [z.latitude, z.longitude]
        const meta = STATUS_META[z.status]
        const labelled = z.status === 'CRITICAL' || z.status === 'ELEVATED'
        return (
          <span key={`${z.zip_code}-${z.status}-${selected === z.zip_code}`}>
            {z.status === 'CRITICAL' && (
              <CircleMarker center={center} radius={r} interactive={false}
                            pathOptions={{ stroke: false, fillColor: meta.color, fillOpacity: 0.45, className: 'pin-halo' }} />
            )}
            <CircleMarker
              center={center} radius={r}
              pathOptions={{
                color: selected === z.zip_code ? '#0b0b0b' : '#ffffff',
                weight: selected === z.zip_code ? 3.5 : 2,
                fillColor: meta.color, fillOpacity: 0.95,
                className: `pin pin-${z.status.toLowerCase()} pin-zone-${z.zip_code}`,
              }}
              eventHandlers={{ click: () => onZoneClick(z.zip_code) }}
            >
              {labelled ? (
                <Tooltip permanent direction="right" offset={[r - 4, 0]} className={`pin-label pin-label-${z.status.toLowerCase()}`}>
                  {shortName(z.zone_name)}
                </Tooltip>
              ) : (
                <Tooltip direction="top" offset={[0, -r]} className="pin-hover">
                  {z.zone_name} · {meta.label}
                </Tooltip>
              )}
            </CircleMarker>
          </span>
        )
      })}
    </>
  )
}

const ARROW_INDEX = 27 // of 32 points: the arrowhead sits just short of the target pin

function Arcs({ arcs, zones }: { arcs: ArcSet; zones: Zone[] }) {
  const [labelsVisible, setLabelsVisible] = useState(false)
  useEffect(() => {
    setLabelsVisible(false)
    const t = window.setTimeout(() => setLabelsVisible(true), 900)
    return () => window.clearTimeout(t)
  }, [arcs.key])
  // Built once per allocation: rebuilding Leaflet icons on every poll would restart their fade-in.
  const drawn = useMemo(() => {
    const byZip = new Map(zones.map((z) => [z.zip_code, z]))
    return arcs.allocations.flatMap((alloc) => {
        const target = byZip.get(alloc.target)
        if (!target) return []
        return alloc.transfers.map((t) => {
          const donor = byZip.get(t.donor)
          if (!donor) return null
          const points = arcPoints([donor.latitude, donor.longitude], [target.latitude, target.longitude])
          const arrow = L.divIcon({
            className: 'arc-arrow-wrap', iconSize: [0, 0],
            html: `<div class="arc-arrow" style="transform: translate(-50%,-50%) rotate(${
              arrowRotation(points.slice(0, ARROW_INDEX + 1))}deg)">➤</div>`,
          })
          // Label at the donor, pushed away from the target, so labels of nearby donors don't stack.
          const label = L.divIcon({
            className: 'arc-label-wrap', iconSize: [0, 0],
            html: `<div class="arc-label" style="transform: ${labelOffset([donor.latitude, donor.longitude],
              [target.latitude, target.longitude])}"><strong>${escapeHtml(shortName(t.donor_name))}</strong>` +
              `<span>PPE ${compact(t.ppe_units)} · Antivirals ${compact(t.antiviral_doses)} · Vaccines ${compact(t.vaccine_doses)}</span></div>`,
          })
          return { key: `${arcs.key}-${alloc.episode_id}-${t.donor}`, points, arrow, label,
                   donorAt: [donor.latitude, donor.longitude] as LatLng }
        }).filter((d) => d !== null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arcs.key])
  return (
    <>
      {drawn.map((d) => (
        <span key={d.key}>
          <Polyline positions={d.points} interactive={false}
                    pathOptions={{ color: '#2a78d6', weight: 5, opacity: 0.95, lineCap: 'round', className: 'arc' }} />
          <Marker position={d.points[ARROW_INDEX]} icon={d.arrow} interactive={false} />
          {labelsVisible && <Marker position={d.donorAt} icon={d.label} interactive={false} />}
        </span>
      ))}
    </>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
