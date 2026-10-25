import { useEffect, useRef, useState } from 'react'
import type { HistoryDay } from '../api/types'
import { shortDate } from '../lib/format'
import { SERIES } from '../lib/status'

export const CRITICAL_LINE = 80
const PAD = { left: 30, right: 10, top: 24, bottom: 20 }
const MARKER_WIDTH = 49

interface Props {
  days: HistoryDay[]        // scored days only
  spike?: string
  alert?: string
  hit?: string
}

/** Risk now (solid) vs the forecast 48 hours ahead (dashed), with spike/alert markers and the lead band. */
export function ScoreChart({ days, spike, alert, hit }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 480, h: 160 })
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { w, h } = size
  const n = days.length
  const X = (i: number) => PAD.left + (n > 1 ? (i * (w - PAD.left - PAD.right)) / (n - 1) : 0)
  const at = (date?: string) => (date ? days.findIndex((d) => d.date === date) : -1)
  const [iSpike, iAlert, iHit] = [at(spike), at(alert), at(hit)]
  const pillX = (i: number) => Math.min(Math.max(X(i), MARKER_WIDTH / 2 + 2), w - MARKER_WIDTH / 2 - 2)
  const stackedMarkers = iSpike >= 0 && iAlert >= 0 && Math.abs(pillX(iSpike) - pillX(iAlert)) < MARKER_WIDTH + 4
  const plotTop = PAD.top + (stackedMarkers ? 20 : 0)
  const Y = (v: number) => plotTop + ((100 - v) * (h - plotTop - PAD.bottom)) / 100
  const path = (key: 'score' | 'projected_score') =>
    days.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d[key] ?? 0).toFixed(1)}`).join('')
  const ticks = n > 1 ? Array.from({ length: 5 }, (_, k) => Math.round((k * (n - 1)) / 4)) : []

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const i = Math.round(((x - PAD.left) / (w - PAD.left - PAD.right)) * (n - 1))
    setHover(i >= 0 && i < n ? i : null)
  }

  return (
    <div className="score-chart" ref={box} data-testid="score-chart">
      {n < 2 ? <p className="muted chart-empty">Not enough data yet.</p> : (
        <svg width={w} height={h} role="img" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
             aria-label="Risk now and the 48-hour forecast over time">
          {[0, 40].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={w - PAD.right} y1={Y(v)} y2={Y(v)} style={{ stroke: 'var(--grid)' }} />
              <text x={PAD.left - 6} y={Y(v) + 4} className="axis" textAnchor="end">{v}</text>
            </g>
          ))}
          {iAlert >= 0 && iHit > iAlert && (
            <rect x={X(iAlert)} y={plotTop} width={X(iHit) - X(iAlert)} height={h - plotTop - PAD.bottom}
                  style={{ fill: 'var(--critical)' }} opacity={0.09} data-testid="lead-band" />
          )}
          <line x1={PAD.left} x2={w - PAD.right} y1={Y(CRITICAL_LINE)} y2={Y(CRITICAL_LINE)} style={{ stroke: 'var(--critical)' }} strokeDasharray="5 4" />
          <text x={PAD.left - 6} y={Y(CRITICAL_LINE) + 4} className="axis axis-critical" textAnchor="end">80</text>
          <text x={PAD.left + 4} y={Y(CRITICAL_LINE) - 5} className="axis axis-critical">Critical</text>
          {iSpike >= 0 && <Marker x={X(iSpike)} top={plotTop} bottom={h - PAD.bottom} label="Spike" kind="spike" pillX={pillX(iSpike)} />}
          {iAlert >= 0 && <Marker x={X(iAlert)} top={plotTop} bottom={h - PAD.bottom} label="Alert" kind="alert"
                                 pillX={pillX(iAlert)} labelTop={stackedMarkers ? 22 : 2} />}
          <path d={path('projected_score')} fill="none" style={{ stroke: SERIES.forecast }} strokeWidth={2.5} strokeDasharray="6 4" />
          <path d={path('score')} fill="none" style={{ stroke: SERIES.current }} strokeWidth={2.5} />
          {iHit >= 0 && <circle cx={X(iHit)} cy={Y(days[iHit].score ?? 0)} r={5} style={{ fill: 'var(--surface)', stroke: 'var(--critical)' }} strokeWidth={2.5} />}
          {ticks.map((i) => (
            <text key={i} x={X(i)} y={h - 4} className="axis" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {shortDate(days[i].date)}
            </text>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={X(hover)} x2={X(hover)} y1={plotTop} y2={h - PAD.bottom} style={{ stroke: 'var(--faint)' }} />
              <circle cx={X(hover)} cy={Y(days[hover].score ?? 0)} r={4} style={{ fill: SERIES.current }} />
              <circle cx={X(hover)} cy={Y(days[hover].projected_score ?? 0)} r={4} style={{ fill: SERIES.forecast }} />
              <foreignObject x={Math.max(0, Math.min(X(hover) + 8, w - 168))} y={Math.min(plotTop, h - 58)} width={160} height={58}>
                <div className="chart-tip">
                  <strong>{shortDate(days[hover].date)}</strong>
                  <span>Risk now {Math.round(days[hover].score ?? 0)}</span>
                  <span>Forecast {Math.round(days[hover].projected_score ?? 0)}</span>
                </div>
              </foreignObject>
            </g>
          )}
        </svg>
      )}
    </div>
  )
}

function Marker({ x, top, bottom, label, kind, pillX, labelTop = 2 }: {
  x: number; top: number; bottom: number; label: string; kind: 'spike' | 'alert'; pillX: number; labelTop?: number
}) {
  const color = kind === 'alert' ? 'var(--critical)' : 'var(--spike-pill)'
  return (
    <g data-testid={`chart-${kind}`}>
      <line x1={x} x2={x} y1={top} y2={bottom} style={{ stroke: color }} strokeWidth={1.5} strokeDasharray={kind === 'spike' ? '3 3' : undefined} />
      <rect x={pillX - MARKER_WIDTH / 2} y={labelTop} width={MARKER_WIDTH} height={18} rx={9} style={{ fill: color }} />
      <text x={pillX} y={labelTop + 13} className="marker-label" textAnchor="middle">{label}</text>
    </g>
  )
}
