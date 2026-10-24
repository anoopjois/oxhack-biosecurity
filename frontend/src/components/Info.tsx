import { useId, useState } from 'react'

/** A small "?" that explains a term in plain language, on hover or click. */
export function Info({ text, label = 'More information', align = 'left' }: { text: string; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="info" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="info-btn" aria-label={label} aria-describedby={open ? id : undefined}
              aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}>?</button>
      {open && <span role="tooltip" id={id} className={`info-pop info-${align}`}>{text}</span>}
    </span>
  )
}
