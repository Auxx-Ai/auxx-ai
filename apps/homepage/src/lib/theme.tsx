// apps/homepage/src/lib/theme.tsx
'use client'

import { createContext, use, useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'theme'
const DEFAULT_THEME = 'dark'
const THEMES = ['quartz', 'dark'] as const

export type Theme = (typeof THEMES)[number]

interface ThemeContext {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContext | null>(null)

export function useTheme() {
  const ctx = use(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

/**
 * Blocking script injected into <head> to set data-theme before paint.
 * Reads from localStorage, falls back to default.
 */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'${DEFAULT_THEME}';document.documentElement.setAttribute('data-theme',t)}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_THEME}')}})()`
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  useEffect(() => {
    const stored = document.documentElement.getAttribute('data-theme') as Theme | null
    if (stored && THEMES.includes(stored)) {
      setThemeState(stored)
    }
  }, [])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch {}
  }, [])

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
}
