// apps/web/src/components/kbar/store.ts
'use client'

import { create } from 'zustand'
import type { PalettePage } from './types'

/** A record carried from the search page into the record-actions page. */
export interface PaletteSelectedRecord {
  /** Full RecordId (`entityDefinitionId:instanceId`). */
  recordId: string
  /** Owning entity definition id. */
  entityDefinitionId: string
  /** Resolved display name (for the breadcrumb + actions header). */
  displayName: string
}

interface CommandPaletteState {
  open: boolean
  page: PalettePage
  /** Selected record for the `record-actions` page. */
  selectedRecord: PaletteSelectedRecord | null
  /** The currently highlighted row on the search page (mirrors cmdk's active item). */
  searchActive: PaletteSelectedRecord | null
  /** Entity definition id for the embedded `create` page. */
  createEntityId: string | null

  openPalette: () => void
  close: () => void
  toggle: () => void
  goTo: (page: PalettePage) => void
  back: () => void
  openRecordActions: (record: PaletteSelectedRecord) => void
  setSearchActive: (record: PaletteSelectedRecord | null) => void
  openCreate: (entityDefinitionId: string) => void
  /** `Meta+K`: open when closed; on the search page open the active record's
   *  actions; otherwise toggle closed. */
  metaK: () => void
}

/** Where the Back button goes from each page. */
const BACK_TARGET: Record<PalettePage, PalettePage> = {
  root: 'root',
  search: 'root',
  'record-actions': 'search',
  create: 'root',
}

/**
 * Single store driving the command palette. Actions and global hotkeys both
 * mutate it via `getState()`, so there is exactly one source of truth for
 * `open` / `page` / the carried record + create target.
 */
export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  open: false,
  page: 'root',
  selectedRecord: null,
  searchActive: null,
  createEntityId: null,

  openPalette: () => set({ open: true, page: 'root' }),
  close: () => set({ open: false }),
  toggle: () => (get().open ? set({ open: false }) : set({ open: true, page: 'root' })),
  goTo: (page) => set({ page }),
  back: () => set({ page: BACK_TARGET[get().page] }),
  openRecordActions: (record) => set({ selectedRecord: record, page: 'record-actions' }),
  setSearchActive: (record) => set({ searchActive: record }),
  openCreate: (entityDefinitionId) =>
    set({ open: true, createEntityId: entityDefinitionId, page: 'create' }),
  metaK: () => {
    const s = get()
    if (!s.open) return set({ open: true, page: 'root' })
    if (s.page === 'search' && s.searchActive) {
      return set({ selectedRecord: s.searchActive, page: 'record-actions' })
    }
    return set({ open: false })
  },
}))
