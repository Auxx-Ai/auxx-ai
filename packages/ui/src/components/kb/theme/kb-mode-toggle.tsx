// packages/ui/src/components/kb/theme/kb-mode-toggle.tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { KBMode } from './kb-theme-tokens'

interface KBModeToggleProps {
  kbId: string
  /** Server-resolved mode (from cookie or KB default) used for SSR/initial render. */
  initialMode?: KBMode
  /**
   * When provided, the toggle also notifies the parent so external state
   * (e.g. apps/web admin preview) can stay in sync. The toggle still writes
   * the cookie + updates the DOM imperatively so first paint is instant.
   */
  onChange?: (mode: KBMode) => void
  className?: string
}

const COOKIE_PREFIX = 'kb-mode-'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function KBModeToggle({
  kbId,
  initialMode = 'light',
  onChange,
  className,
}: KBModeToggleProps) {
  const [mode, setMode] = useState<KBMode>(initialMode)

  // Keep the icon in sync when the parent drives the mode (apps/web preview).
  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  const toggle = useCallback(() => {
    const next: KBMode = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
    applyMode(kbId, next)
    document.cookie = `${COOKIE_PREFIX}${kbId}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    onChange?.(next)
  }, [kbId, mode, onChange])

  return (
    <button
      type='button'
      onClick={toggle}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={className}>
      {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

function applyMode(kbId: string, mode: KBMode) {
  const root = document.querySelector<HTMLElement>(`[data-kb-id="${cssEscape(kbId)}"]`)
  if (root) root.setAttribute('data-kb-mode', mode)
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}
