// apps/web/src/components/favorites/hooks/use-favorite-toggle.ts
'use client'

import type { FavoriteTargetIdsMap, FavoriteTargetType } from '@auxx/lib/favorites/client'
import type { SidebarNodeEntity } from '@auxx/lib/sidebar-layout/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useSidebarNodesApi } from '~/components/global/sidebar/tree/sidebar-nodes-provider'
import { api } from '~/trpc/react'
import { useFavoriteForTarget } from './use-is-favorited'

/**
 * Toggle favorite status for a (targetType, targetIds). Performs optimistic
 * store updates; reverts on failure. Returns `{ toggle, isFavorited, isPending }`.
 */
export function useFavoriteToggle<T extends FavoriteTargetType>(
  targetType: T,
  targetIds: FavoriteTargetIdsMap[T] | null | undefined
) {
  const existing = useFavoriteForTarget(targetType, targetIds)
  const store = useSidebarNodesApi()

  const utils = api.useUtils()
  const add = api.favorite.add.useMutation({
    onSuccess: (created) => {
      store.getState().upsert(created as unknown as SidebarNodeEntity)
      void utils.sidebar.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Could not add favorite', description: error.message })
      void utils.sidebar.list.invalidate()
    },
  })
  const remove = api.favorite.remove.useMutation({
    onSuccess: () => {
      void utils.sidebar.list.invalidate()
    },
    onError: (error, variables) => {
      // Re-add optimistically removed row by refetching; simpler than rebuilding from variables.
      toastError({ title: 'Could not remove favorite', description: error.message })
      void utils.sidebar.list.invalidate()
      void variables
    },
  })

  const toggle = useCallback(() => {
    if (!targetIds) return
    if (existing) {
      store.getState().removeById(existing.id)
      remove.mutate({ favoriteId: existing.id })
    } else {
      add.mutate({ targetType, targetIds } as Parameters<typeof add.mutate>[0])
    }
  }, [existing, store, remove, add, targetType, targetIds])

  return {
    toggle,
    isFavorited: !!existing,
    isPending: add.isPending || remove.isPending,
  }
}
