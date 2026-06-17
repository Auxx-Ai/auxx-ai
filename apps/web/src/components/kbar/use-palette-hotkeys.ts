// apps/web/src/components/kbar/use-palette-hotkeys.ts
'use client'

import { useHotkey, useHotkeySequence } from '@tanstack/react-hotkeys'
import { SHORTCUTS } from './shortcuts'
import { useCommandPaletteStore } from './store'
import type { PaletteAction } from './types'

const HOTKEY_TIMEOUT = 500

/**
 * Stable, module-level list of `[actionId, UPPERCASE sequence]`. The order never
 * changes (SHORTCUTS is a constant), so iterating it with `useHotkeySequence`
 * keeps a fixed hook-call count across renders.
 */
const CHORD_ENTRIES: Array<[string, string[]]> = Object.entries(SHORTCUTS).map(([id, seq]) => [
  id,
  seq.map((k) => k.toUpperCase()),
])

/**
 * The single global binding system for the palette:
 * - `Meta+K` / `Ctrl+K` toggles the palette (fires even inside inputs).
 * - every {@link SHORTCUTS} chord fires its action's `perform` (suppressed while
 *   typing in an input, and disabled while the palette itself is open).
 *
 * Replaces kbar's tinykeys bindings and the scattered tanstack hooks in the old
 * `use-theme-switching`.
 */
export function usePaletteHotkeys(byId: Map<string, PaletteAction>): void {
  const open = useCommandPaletteStore((s) => s.open)

  useHotkey(
    'Mod+K',
    (event) => {
      event.preventDefault()
      useCommandPaletteStore.getState().metaK()
    },
    { preventDefault: true }
  )

  // One registration per chord. `useHotkeySequence` re-syncs the callback every
  // render, so the closure always sees the latest `byId`.
  for (const [actionId, sequence] of CHORD_ENTRIES) {
    // biome-ignore lint/correctness/useHookAtTopLevel: CHORD_ENTRIES is a fixed-length module constant, so the hook count is stable.
    useHotkeySequence(
      sequence,
      () => {
        byId.get(actionId)?.perform()
      },
      { timeout: HOTKEY_TIMEOUT, enabled: !open }
    )
  }
}
