// apps/web/src/components/favorites/hooks/use-favorite-drag-end.ts
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { useCallback } from 'react'
import { useFavoritesStore } from '../store/favorites-store'
import { useFavoriteMove } from './use-favorite-move'
import { useFavoriteReorder } from './use-favorite-reorder'

interface FavoriteDragData {
  type: 'favorite'
  favoriteId: string
  nodeType: 'ITEM' | 'FOLDER'
  parentFolderId: string | null
  index: number
}

type AnyDropData = Record<string, unknown> | undefined

function bySortOrder(a: FavoriteEntity, b: FavoriteEntity): number {
  return a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0
}

/**
 * Resolves a dnd-kit drop into either a reorder mutation, a move mutation,
 * or a no-op. Pure routing — store updates and tRPC calls happen inside
 * useFavoriteReorder / useFavoriteMove.
 */
export function useFavoriteDragEnd() {
  const { reorderInGroup } = useFavoriteReorder()
  const { moveToFolder } = useFavoriteMove()

  return useCallback(
    (activeData: FavoriteDragData, overData: AnyDropData) => {
      const state = useFavoritesStore.getState()
      const fav = state.byId[activeData.favoriteId]
      if (!fav) return

      const overType = overData?.type as string | undefined

      // Case A: dropped on a folder header drop-target → move into folder
      if (overType === 'favorite-folder-target') {
        const targetFolderId = overData!.folderId as string
        if (fav.nodeType === 'FOLDER') return // folders cannot nest
        if ((fav.parentFolderId ?? null) === targetFolderId) return
        moveToFolder(fav.id, targetFolderId)
        return
      }

      // Case B: dropped on a sibling row (the sortable's own data carries 'favorite').
      // If the over node is a FOLDER and we're dragging an ITEM, treat it as
      // a move-into-folder rather than a reorder (the folder is both sortable
      // and droppable; either branch should produce the same result).
      if (overType === 'favorite') {
        const overNodeType = overData!.nodeType as 'ITEM' | 'FOLDER'
        const targetFavoriteId = overData!.favoriteId as string

        if (overNodeType === 'FOLDER' && fav.nodeType === 'ITEM') {
          if ((fav.parentFolderId ?? null) === targetFavoriteId) return
          moveToFolder(fav.id, targetFavoriteId)
          return
        }

        const targetParentId = (overData!.parentFolderId as string | null) ?? null
        const sourceParentId = activeData.parentFolderId ?? null

        // Cross-parent: simpler v1 — move into target's parent at end
        if (sourceParentId !== targetParentId) {
          if (fav.nodeType === 'FOLDER' && targetParentId !== null) return // folders cannot nest
          moveToFolder(fav.id, targetParentId)
          return
        }

        // Same parent: reorder within sibling group
        const allRows = Object.values(state.byId)
        const siblings = allRows
          .filter((r) => (r.parentFolderId ?? null) === targetParentId)
          .sort(bySortOrder)

        const oldIndex = siblings.findIndex((s) => s.id === fav.id)
        const newIndex = siblings.findIndex((s) => s.id === targetFavoriteId)
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

        reorderInGroup(siblings, oldIndex, newIndex)
      }
    },
    [reorderInGroup, moveToFolder]
  )
}
