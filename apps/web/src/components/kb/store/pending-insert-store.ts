// apps/web/src/components/kb/store/pending-insert-store.ts
'use client'

import type { ArticleKind } from '@auxx/database/types'
import { create } from 'zustand'

/**
 * Coordinates the inline "type a title to create" affordance across the
 * sidebar. At most one pending insert is visible at a time. The position is
 * expressed the same way `createArticle` consumes it (parentId + optional
 * adjacent sibling + relative position), so committing the pending row is a
 * direct hand-off to the existing mutation.
 */
export interface PendingInsert {
  articleKind: ArticleKind
  parentId: string | null
  adjacentTo?: string
  position?: 'before' | 'after'
}

interface PendingInsertStoreState {
  pending: PendingInsert | null
  setPending: (insert: PendingInsert) => void
  clearPending: () => void
}

export const usePendingInsertStore = create<PendingInsertStoreState>((set) => ({
  pending: null,
  setPending: (insert) => set({ pending: insert }),
  clearPending: () => set({ pending: null }),
}))

export const getPendingInsertState = () => usePendingInsertStore.getState()
