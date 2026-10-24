import { useEffect, useMemo, useRef, useState } from 'react'
import type { Zone } from '../api/types'
import { doublingDays } from '../lib/format'

export const R_MIN = 0.05
export const R_MAX = 1.0
export const R_DEFAULT = 0.4

interface Props {
  zones: Zone[]
  selected: string
  onSelect: (zip: string) => void
  onInject: (zip: string, r: number) => Promise<void>
  onClose: () => void
}

/** Floating (non-modal) panel, so a click on the map can pick the target zone while it is open. */
export function SpikeDialog({ zones, selected, onSelect, onInject, onClose }: Props) {
  const [r, setR] = useState(R_DEFAULT)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const select = useRef<HTMLSelectElement>(null)
  useEffect(() => select.current?.focus(), [])

  const byRegion = useMemo(() => {
    const groups = new Map<string, Zone[]>()
    for (const z of [...zones].sort((a, b) => a.zone_name.localeCompare(b.zone_name))) {
      groups.set(z.region, [...(groups.get(z.region) ?? []), z])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [zones])

  async function inject() {
    if (!selected) return
    setSending(true)
    setError(null)
    try {
      await onInject(selected, r)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="spike-dialog popover popover-right" role="dialog" aria-label="Simulate pathogen spike" data-testid="spike-dialog"
         onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <h2>Simulate a pathogen spike</h2>
      <p className="hint">A hidden outbreak the system has to discover on its own.</p>
      <label className="field">
        <span>Area</span>
        <select ref={select} value={selected} onChange={(e) => onSelect(e.target.value)} data-testid="spike-zone">
          <option value="" disabled>Choose an area…</option>
          {byRegion.map(([region, list]) => (
            <optgroup key={region} label={region}>
              {list.map((z) => <option key={z.zip_code} value={z.zip_code}>{z.zone_name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="hint">…or click an area on the map.</p>
      <label className="field">
        <span>Growth rate r = <strong data-testid="spike-r">{r.toFixed(2)}</strong> per day</span>
        <input type="range" min={R_MIN} max={R_MAX} step={0.05} value={r}
               onChange={(e) => setR(Number(e.target.value))} data-testid="spike-r-input" />
      </label>
      <p className="hint" data-testid="spike-doubling">Viral load doubles every {doublingDays(r).toFixed(1)} days</p>
      {error && <p className="error" role="alert" data-testid="spike-error">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-primary" onClick={inject} disabled={!selected || sending} data-testid="spike-inject">
          Inject spike
        </button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
