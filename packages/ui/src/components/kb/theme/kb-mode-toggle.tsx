// packages/ui/src/components/kb/theme/kb-mode-toggle.tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { KBMode } from './kb-theme-tokens'

interface KBModeToggleProps {
  kbId: string
  /** Default mode when no localStorage value is set. */
  initialMode?: KBMode
  className?: string
}

const STORAGE_PREFIX = 'kb-mode:'

export function KBModeToggle({ kbId, initialMode = 'light', className }: KBModeToggleProps) {
  const [mode, setMode] = useState<KBMode>(initialMode)

  useEffect(() => {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${kbId}`) as KBMode | null
    const next = stored === 'dark' || stored === 'light' ? stored : initialMode
    setMode(next)
    applyMode(kbId, next)
  }, [kbId, initialMode])

  const toggle = useCallback(() => {
    const next: KBMode = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
    applyMode(kbId, next)
    window.localStorage.setItem(`${STORAGE_PREFIX}${kbId}`, next)
  }, [kbId, mode])

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
