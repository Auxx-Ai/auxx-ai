// apps/web/src/components/kbar/store.ts
'use client'

import type { RecordId } from '@auxx/lib/field-values/client'
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
  /** Optional folder pre-selection for the embedded `create-snippet` page. */
  createSnippetFolderId: string | null
  /** Optional record to pre-link on the embedded `create-task` page. */
  createTaskRef: RecordId | null

  openPalette: () => void
  close: () => void
  toggle: () => void
  goTo: (page: PalettePage) => void
  back: () => void
  openRecordActions: (record: PaletteSelectedRecord) => void
  setSearchActive: (record: PaletteSelectedRecord | null) => void
  openCreate: (entityDefinitionId: string) => void
  openCreateSnippet: (folderId?: string) => void
  openCreateSignature: () => void
  openCreateTask: (ref?: RecordId) => void
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
  'create-snippet': 'root',
  'create-signature': 'root',
  'create-task': 'root',
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
  createSnippetFolderId: null,
  createTaskRef: null,

  openPalette: () => set({ open: true, page: 'root' }),
  close: () => set({ open: false, createSnippetFolderId: null, createTaskRef: null }),
  toggle: () => (get().open ? set({ open: false }) : set({ open: true, page: 'root' })),
  goTo: (page) => set({ page }),
  back: () => set({ page: BACK_TARGET[get().page] }),
  openRecordActions: (record) => set({ selectedRecord: record, page: 'record-actions' }),
  setSearchActive: (record) => set({ searchActive: record }),
  openCreate: (entityDefinitionId) =>
    set({ open: true, createEntityId: entityDefinitionId, page: 'create' }),
  openCreateSnippet: (folderId) =>
    set({ open: true, createSnippetFolderId: folderId ?? null, page: 'create-snippet' }),
  openCreateSignature: () => set({ open: true, page: 'create-signature' }),
  openCreateTask: (ref) => set({ open: true, createTaskRef: ref ?? null, page: 'create-task' }),
  metaK: () => {
    const s = get()
    if (!s.open) return set({ open: true, page: 'root' })
    if (s.page === 'search' && s.searchActive) {
      return set({ selectedRecord: s.searchActive, page: 'record-actions' })
    }
    return set({ open: false })
  },
}))
