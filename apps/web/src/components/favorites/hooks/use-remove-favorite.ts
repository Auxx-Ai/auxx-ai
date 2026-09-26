// apps/web/src/components/favorites/hooks/use-remove-favorite.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useSidebarNodesApi } from '~/components/global/sidebar/tree/sidebar-nodes-provider'
import { api } from '~/trpc/react'

/**
 * Remove a favorite from the sidebar. Optimistically drops it from the store,
 * then persists via tRPC. Shared by every render state (row, skeleton, broken)
 * so a favorite is always removable — including while its target is still loading.
 */
export function useRemoveFavorite(favoriteId: string) {
  const store = useSidebarNodesApi()
  const utils = api.useUtils()
  const { mutate } = api.favorite.remove.useMutation({
    onSuccess: () => void utils.sidebar.list.invalidate(),
    onError: (error) => {
      toastError({ title: 'Could not remove favorite', description: error.message })
      void utils.sidebar.list.invalidate()
    },
  })

  return useCallback(() => {
    store.getState().removeById(favoriteId)
    mutate({ favoriteId })
  }, [favoriteId, store, mutate])
}
