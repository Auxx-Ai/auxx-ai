// apps/web/src/components/favorites/hooks/use-remove-favorite.ts
'use client'

import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { useFavoritesStore } from '../store/favorites-store'

/**
 * Remove a favorite from the sidebar. Optimistically drops it from the store,
 * then persists via tRPC. Shared by every render state (row, skeleton, broken)
 * so a favorite is always removable — including while its target is still loading.
 */
export function useRemoveFavorite(favoriteId: string) {
  const removeById = useFavoritesStore((s) => s.removeById)
  const utils = api.useUtils()
  const removeMutation = api.favorite.remove.useMutation({
    onSuccess: () => void utils.favorite.list.invalidate(),
  })

  return useCallback(() => {
    removeById(favoriteId)
    removeMutation.mutate({ favoriteId })
  }, [favoriteId, removeById, removeMutation])
}
