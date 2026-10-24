import type { Status } from '../api/types'
import { STATUS_META } from '../lib/status'

export function StatusChip({ status, large = false }: { status: Status; large?: boolean }) {
  const meta = STATUS_META[status]
  return (
    <span className={`chip${large ? ' chip-large' : ''}`} data-status={status}
          style={{ background: meta.color, color: meta.ink }}>
      {meta.label.toUpperCase()}
    </span>
  )
}
