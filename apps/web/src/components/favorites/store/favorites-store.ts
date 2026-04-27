// apps/web/src/components/favorites/store/favorites-store.ts
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { create } from 'zustand'

interface FavoritesState {
  byId: Record<string, FavoriteEntity>
  hydrated: boolean

  setAll: (favorites: FavoriteEntity[]) => void
  upsert: (favorite: FavoriteEntity) => void
  removeById: (id: string) => void
  applyReorder: (updates: { id: string; sortOrder: string }[]) => void
  applyMove: (id: string, parentFolderId: string | null, sortOrder: string) => void
}

/** Raw favorite rows. Display data is resolved per-renderer via existing app-wide stores or lazy hooks. */
export const useFavoritesStore = create<FavoritesState>((set) => ({
  byId: {},
  hydrated: false,

  setAll: (favorites) =>
    set(() => {
      const byId: Record<string, FavoriteEntity> = {}
      for (const f of favorites) byId[f.id] = f
      return { byId, hydrated: true }
    }),

  upsert: (favorite) =>
    set((state) => ({
      byId: { ...state.byId, [favorite.id]: favorite },
    })),

  removeById: (id) =>
    set((state) => {
      const next = { ...state.byId }
      delete next[id]
      // Remove any children whose parent was deleted (cascade simulation for optimistic)
      for (const [childId, child] of Object.entries(next)) {
        if (child.parentFolderId === id) delete next[childId]
      }
      return { byId: next }
    }),

  applyReorder: (updates) =>
    set((state) => {
      const next = { ...state.byId }
      for (const u of updates) {
        const existing = next[u.id]
        if (existing) next[u.id] = { ...existing, sortOrder: u.sortOrder }
      }
      return { byId: next }
    }),

  applyMove: (id, parentFolderId, sortOrder) =>
    set((state) => {
      const existing = state.byId[id]
      if (!existing) return state
      return {
        byId: {
          ...state.byId,
          [id]: { ...existing, parentFolderId, sortOrder },
        },
      }
    }),
}))
