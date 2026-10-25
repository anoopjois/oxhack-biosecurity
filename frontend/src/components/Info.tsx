import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** A small "?" that explains a term in plain language, on hover or click. */
export function Info({ text, label = 'More information', align = 'left' }: { text: string; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLSpanElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      if (!button.current || !tooltip.current) return
      const anchor = button.current.getBoundingClientRect()
      const tip = tooltip.current.getBoundingClientRect()
      const left = align === 'right' ? anchor.right - tip.width : anchor.left - 8
      const top = anchor.bottom + 6 + tip.height <= window.innerHeight - 8
        ? anchor.bottom + 6 : anchor.top - tip.height - 6
      tooltip.current.style.left = `${Math.max(8, Math.min(left, window.innerWidth - tip.width - 8))}px`
      tooltip.current.style.top = `${Math.max(8, top)}px`
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open, align])
  return (
    <span className="info" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button ref={button} type="button" className="info-btn" aria-label={label} aria-describedby={open ? id : undefined}
              aria-expanded={open} onClick={() => setOpen(true)} onFocus={() => setOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
              onBlur={() => setOpen(false)}>?</button>
      {open && createPortal(<span ref={tooltip} role="tooltip" id={id} className="info-pop">{text}</span>, document.body)}
    </span>
  )
}
