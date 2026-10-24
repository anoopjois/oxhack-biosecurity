import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AllocationPayload, SimEvent, Zone } from '../api/types'
import { ITEMS } from '../api/types'
import { compact, int } from '../lib/format'

import { inventoryBars, ITEM_LABELS, type HubBar } from '../lib/inventory'
import { SERIES } from '../lib/status'

const axisK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** X-axis hub name on up to two lines ("Greater / Manchester"), bold for the target. */
function HubTick({ x, y, payload, index }: { x?: number; y?: number; payload?: { value: string }; index?: number }) {
  const words = (payload?.value ?? '').split(' ')
  const lines = words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : words
  return (
    <text x={x} y={(y ?? 0) + 4} textAnchor="middle" fontSize={13} fill="#1a1a1a" fontWeight={index === 0 ? 750 : 500}>
      {lines.map((line, i) => <tspan key={i} x={x} dy={i === 0 ? 10 : 15}>{line}</tspan>)}
    </text>
  )
}

/** Below this viewport width, three bar charts get too cramped to label; show a table instead. */
export const NARROW_QUERY = '(max-width: 1500px)'

function useNarrow(): boolean {
  const query = () => typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY).matches
  const [narrow, setNarrow] = useState(query)
  useEffect(() => {
    const mql = window.matchMedia?.(NARROW_QUERY)
    if (!mql) return
    const onChange = () => setNarrow(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return Boolean(narrow)
}

function InventoryTable({ bars }: { bars: Record<(typeof ITEMS)[number], HubBar[]> }) {
  return (
    <table className="inventory-table" data-testid="inventory-table">
      <thead>
        <tr><th>Hub</th>{ITEMS.map((item) => <th key={item}>{ITEM_LABELS[item]}</th>)}</tr>
      </thead>
      <tbody>
        {bars.ppe_units.map((row, i) => (
          <tr key={row.name} className={row.role === 'target' ? 'target-row' : undefined}>
            <td>{row.name}{row.role === 'target' ? ' (target)' : ''}</td>
            {ITEMS.map((item) => {
              const { before, after } = bars[item][i]
              return (
                <td key={item}>
                  {compact(before)} → <span className={after >= before ? 'delta-up' : 'delta-down'}>
                    {compact(after)} {after >= before ? '▲' : '▼'}</span>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface Props {
  allocation: SimEvent | undefined
  zones: Zone[]
}

export function InventoryPanel({ allocation, zones }: Props) {
  const narrow = useNarrow()
  if (!allocation) {
    return (
      <section className="panel inventory" data-testid="inventory">
        <div className="panel-head"><h2>Inventory</h2></div>
        <p className="muted inventory-empty">No transfers yet. When a zone turns critical, its stock and its donors’ stock appear here, before and after.</p>
      </section>
    )
  }
  const payload = allocation.payload as unknown as AllocationPayload
  const targetName = zones.find((z) => z.zip_code === payload.target)?.zone_name ?? payload.target
  const bars = inventoryBars(payload, targetName)
  return (
    <section className="panel inventory" data-testid="inventory">
      <div className="panel-head">
        <h2>Inventory · <span data-testid="inventory-target">{targetName}</span>
          <span className="muted"> ← {payload.transfers.length} hub{payload.transfers.length === 1 ? '' : 's'}</span></h2>
        <span className="legend-inline">
          <span className="swatch" style={{ background: SERIES.before }} /> Before
          <span className="swatch" style={{ background: SERIES.after }} /> After
        </span>
      </div>
      {narrow ? <InventoryTable bars={bars} /> : <div className="inventory-charts">
        {ITEMS.map((item) => (
          <div key={item} className="inventory-chart">
            <h3>{ITEM_LABELS[item]} <span className="muted">· surge target {int(payload.surge_target[item])}</span></h3>
            <div className="inventory-plot">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bars[item]} margin={{ top: 22, right: 8, bottom: 0, left: 0 }} barGap={2}>
                  <CartesianGrid stroke="#e1e0d9" vertical={false} />
                  <XAxis dataKey="hub" interval={0} tick={<HubTick />} height={36} tickLine={false} />
                  <YAxis tickFormatter={axisK} tick={{ fontSize: 12, fill: '#52514e' }} width={44} />
                  <Tooltip formatter={(v) => int(Number(v))} labelFormatter={(_, p) => p?.[0]?.payload?.name ?? ''} />
                  <Legend wrapperStyle={{ display: 'none' }} />
                  <Bar dataKey="before" name="Before" fill={SERIES.before} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="after" name="After" fill={SERIES.after} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    <LabelList dataKey="after" position="top"
                               formatter={(v: unknown) => compact(Number(v))}
                               style={{ fontSize: 12, fill: '#1a1a1a', fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>}
    </section>
  )
}
