// apps/web/src/components/favorites/hooks/use-favorite-reorder.ts
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { toastError } from '@auxx/ui/components/toast'
import { getSmartSortPositions } from '@auxx/utils'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { useFavoritesStore } from '../store/favorites-store'

/**
 * Reorder a sibling group of favorites. Computes minimal sortOrder updates,
 * applies them optimistically, and persists via tRPC.
 */
export function useFavoriteReorder() {
  const applyReorder = useFavoritesStore((s) => s.applyReorder)

  const utils = api.useUtils()
  const reorder = api.favorite.reorder.useMutation({
    onSuccess: () => void utils.favorite.list.invalidate(),
    onError: (error) => {
      toastError({ title: 'Could not save order', description: error.message })
      void utils.favorite.list.invalidate()
    },
  })

  const reorderInGroup = useCallback(
    (siblings: FavoriteEntity[], oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return
      const updates = getSmartSortPositions(siblings, oldIndex, newIndex)
      if (updates.length === 0) return
      applyReorder(updates)
      reorder.mutate({ updates })
    },
    [applyReorder, reorder]
  )

  return { reorderInGroup, isPending: reorder.isPending }
}
