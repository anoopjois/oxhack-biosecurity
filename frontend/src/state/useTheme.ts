import { useCallback, useEffect, useState } from 'react'

/** 'auto' follows the operating system; 'light' and 'dark' pin it. */
export type ThemePref = 'auto' | 'light' | 'dark'
export const THEME_PREFS: ThemePref[] = ['auto', 'light', 'dark']

const STORAGE_KEY = 'theme'

function load(): ThemePref {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'auto'
  } catch {
    return 'auto' // storage blocked (private window): fall back to the system setting
  }
}

/**
 * The colour theme. CSS reads `data-theme` on <html>: none = follow the system
 * (prefers-color-scheme), "light" / "dark" = pinned by the viewer and remembered.
 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(load)
  useEffect(() => {
    const root = document.documentElement
    if (pref === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', pref)
    try {
      window.localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      // not remembered; it still applies for this visit
    }
  }, [pref])
  const cycle = useCallback(() => setPref((p) => THEME_PREFS[(THEME_PREFS.indexOf(p) + 1) % THEME_PREFS.length]), [])
  return { pref, setPref, cycle }
}
