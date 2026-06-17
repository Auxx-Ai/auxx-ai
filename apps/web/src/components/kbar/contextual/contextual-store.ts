// apps/web/src/components/kbar/contextual/contextual-store.ts
'use client'

import { create } from 'zustand'
import type { CommandActionSlice, CommandContextSlice } from './types'

/**
 * Distributed registry for page-defined command-palette rows. Mirrors the
 * Kopilot slice pattern (`kopilot-store`): every `<CommandContext>` /
 * `<CommandAction>` writes one slice keyed by its `useId()` on mount and clears
 * it on unmount.
 *
 * Kept SEPARATE from `useCommandPaletteStore` so surface re-registration churn
 * never touches the palette's open/page state (and vice-versa).
 */
interface ContextualState {
  actionSlices: Record<string, CommandActionSlice>
  contextSlices: Record<string, CommandContextSlice>
  setActionSlice: (id: string, slice: CommandActionSlice) => void
  clearActionSlice: (id: string) => void
  setContextSlice: (id: string, slice: CommandContextSlice) => void
  clearContextSlice: (id: string) => void
}

export const useContextualActionsStore = create<ContextualState>()((set) => ({
  actionSlices: {},
  contextSlices: {},

  setActionSlice: (id, slice) => set((s) => ({ actionSlices: { ...s.actionSlices, [id]: slice } })),
  clearActionSlice: (id) =>
    set((s) => {
      if (!(id in s.actionSlices)) return s
      const next = { ...s.actionSlices }
      delete next[id]
      return { actionSlices: next }
    }),

  setContextSlice: (id, slice) =>
    set((s) => ({ contextSlices: { ...s.contextSlices, [id]: slice } })),
  clearContextSlice: (id) =>
    set((s) => {
      if (!(id in s.contextSlices)) return s
      const next = { ...s.contextSlices }
      delete next[id]
      return { contextSlices: next }
    }),
}))
