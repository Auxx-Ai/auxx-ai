// apps/web/src/components/favorites/store/folder-collapse-store.ts
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FolderCollapseState {
  /** folderId -> 'open' | 'closed'; missing = open by default */
  state: Record<string, 'open' | 'closed'>
  toggle: (folderId: string) => void
  setOpen: (folderId: string, open: boolean) => void
}

export const useFolderCollapseStore = create<FolderCollapseState>()(
  persist(
    (set) => ({
      state: {},
      toggle: (folderId) =>
        set((s) => ({
          state: {
            ...s.state,
            [folderId]: s.state[folderId] === 'closed' ? 'open' : 'closed',
          },
        })),
      setOpen: (folderId, open) =>
        set((s) => ({
          state: { ...s.state, [folderId]: open ? 'open' : 'closed' },
        })),
    }),
    { name: 'auxx:favorites:folder-collapse' }
  )
)
