// apps/web/src/components/favorites/providers/favorites-provider.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { type ReactNode, useEffect } from 'react'
import { api } from '~/trpc/react'
import { useFavoritesStore } from '../store/favorites-store'

/**
 * Loads favorites once via tRPC (served from user cache) and seeds the
 * client store. Mutations elsewhere update the store optimistically and
 * invalidate the query.
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const setAll = useFavoritesStore((s) => s.setAll)
  const { data } = api.favorite.list.useQuery(undefined, {
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (data) setAll(data as FavoriteEntity[])
  }, [data, setAll])

  return <>{children}</>
}
