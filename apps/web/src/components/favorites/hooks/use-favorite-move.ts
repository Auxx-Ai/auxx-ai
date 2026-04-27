// apps/web/src/components/favorites/hooks/use-favorite-move.ts
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { toastError } from '@auxx/ui/components/toast'
import { generateKeyBetween } from '@auxx/utils'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { useFavoritesStore } from '../store/favorites-store'

function bySortOrder(a: FavoriteEntity, b: FavoriteEntity): number {
  return a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0
}

/**
 * Move a favorite into a folder (or to root). Optimistic store update +
 * tRPC mutation. The optimistic sortOrder lands the item at the end of the
 * new sibling group; the server recomputes from scratch and either matches
 * or invalidation refetches the truth.
 */
export function useFavoriteMove() {
  const applyMove = useFavoritesStore((s) => s.applyMove)
  const utils = api.useUtils()

  const move = api.favorite.move.useMutation({
    onSuccess: () => void utils.favorite.list.invalidate(),
    onError: (error) => {
      toastError({ title: 'Could not move favorite', description: error.message })
      void utils.favorite.list.invalidate()
    },
  })

  const moveToFolder = useCallback(
    (favoriteId: string, parentFolderId: string | null) => {
      const state = useFavoritesStore.getState()
      const fav = state.byId[favoriteId]
      if (!fav) return
      if ((fav.parentFolderId ?? null) === parentFolderId) return

      // Optimistic sortOrder: end of new sibling group
      const siblings = Object.values(state.byId)
        .filter((f) => f.id !== favoriteId && (f.parentFolderId ?? null) === parentFolderId)
        .sort(bySortOrder)
      const last = siblings[siblings.length - 1]?.sortOrder ?? null
      const sortOrder = generateKeyBetween(last, null)

      applyMove(favoriteId, parentFolderId, sortOrder)
      move.mutate({ favoriteId, parentFolderId })
    },
    [applyMove, move]
  )

  return { moveToFolder, isPending: move.isPending }
}
