// apps/web/src/components/favorites/hooks/use-is-favorited.ts
'use client'

import type {
  FavoriteEntity,
  FavoriteTargetIdsMap,
  FavoriteTargetType,
} from '@auxx/lib/favorites/client'
import { favoriteTargetKey } from '@auxx/lib/favorites/client'
import { useMemo } from 'react'
import { useFavoritesStore } from '../store/favorites-store'

/**
 * Returns the existing favorite row for (targetType, targetIds), or null.
 * Cheap selector: scans the byId map (≤50 entries hard cap).
 */
export function useFavoriteForTarget<T extends FavoriteTargetType>(
  targetType: T | null | undefined,
  targetIds: FavoriteTargetIdsMap[T] | null | undefined
): FavoriteEntity | null {
  const byId = useFavoritesStore((s) => s.byId)
  return useMemo(() => {
    if (!targetType || !targetIds) return null
    const wantKey = favoriteTargetKey(targetType, targetIds)
    for (const fav of Object.values(byId)) {
      if (fav.nodeType !== 'ITEM') continue
      if (!fav.targetType || !fav.targetIds) continue
      if (
        favoriteTargetKey(
          fav.targetType,
          fav.targetIds as FavoriteTargetIdsMap[FavoriteTargetType]
        ) === wantKey
      ) {
        return fav
      }
    }
    return null
  }, [byId, targetType, targetIds])
}

export function useIsFavorited<T extends FavoriteTargetType>(
  targetType: T | null | undefined,
  targetIds: FavoriteTargetIdsMap[T] | null | undefined
): boolean {
  return useFavoriteForTarget(targetType, targetIds) !== null
}
