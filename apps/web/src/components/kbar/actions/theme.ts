// apps/web/src/components/kbar/actions/theme.ts
'use client'

import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import { SHORTCUTS } from '../shortcuts'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * Theme actions. Their chords (`t,t` / `t,l` / `t,d`) are bound globally by
 * `use-palette-hotkeys` from {@link SHORTCUTS} — the only binding system now
 * (the old `use-theme-switching` tanstack bindings are gone).
 */
export function useThemeActions(): PaletteAction[] {
  const { theme, setTheme } = useTheme()

  return useMemo<PaletteAction[]>(() => {
    const apply = (next: string) => {
      setTheme(next)
      useCommandPaletteStore.getState().close()
    }
    return [
      {
        id: 'theme.toggle',
        label: 'Toggle Theme',
        icon: 'sun',
        keywords: 'dark light theme toggle',
        shortcut: SHORTCUTS['theme.toggle'],
        perform: () => apply(theme === 'light' ? 'dark' : 'light'),
      },
      {
        id: 'theme.light',
        label: 'Set Light Theme',
        icon: 'sun',
        keywords: 'light theme',
        shortcut: SHORTCUTS['theme.light'],
        perform: () => apply('light'),
      },
      {
        id: 'theme.dark',
        label: 'Set Dark Theme',
        icon: 'moon',
        keywords: 'dark theme',
        shortcut: SHORTCUTS['theme.dark'],
        perform: () => apply('dark'),
      },
    ]
  }, [theme, setTheme])
}
