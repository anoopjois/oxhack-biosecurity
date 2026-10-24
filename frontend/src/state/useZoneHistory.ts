import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ZoneHistory } from '../api/types'

/** A zone's day-by-day score history, refetched when the day or the run changes. */
export function useZoneHistory(zip: string | null | undefined, day: number | null, run: number | null): ZoneHistory | null {
  const [history, setHistory] = useState<ZoneHistory | null>(null)
  useEffect(() => {
    if (!zip) return
    let cancelled = false
    api.zoneHistory(zip).then((h) => { if (!cancelled) setHistory(h) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [zip, day, run])
  return zip && history?.zip_code === zip ? history : null
}
