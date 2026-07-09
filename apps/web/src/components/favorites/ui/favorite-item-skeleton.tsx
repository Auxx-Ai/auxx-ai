// apps/web/src/components/favorites/ui/favorite-item-skeleton.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { useEffect, useState } from 'react'
import { FavoriteRemoveButton } from './favorite-remove-button'
import { PrivateItem } from './private-item'

/** How long a favorite may stay loading before we treat its target as broken. */
const STUCK_AFTER_MS = 10_000

/**
 * Loading placeholder for a favorite whose target hasn't resolved yet.
 *
 * When a `favoriteId` is provided the row stays removable while loading, and if
 * the target never resolves (e.g. a deleted item the API returns as empty, or a
 * global store that never finishes loading) it self-heals into the broken +
 * removable state after {@link STUCK_AFTER_MS} so the user is never stuck.
 */
export function FavoriteItemSkeleton({ favoriteId }: { favoriteId?: string }) {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    if (!favoriteId) return
    const timer = setTimeout(() => setStuck(true), STUCK_AFTER_MS)
    return () => clearTimeout(timer)
  }, [favoriteId])

  if (stuck && favoriteId) return <PrivateItem favoriteId={favoriteId} />

  return (
    <div className='group/item flex h-7 w-full items-center px-2'>
      <Skeleton className='size-4 mr-2 shrink-0 rounded-sm' />
      <Skeleton className='h-3 w-24' />
      {favoriteId ? (
        <div className='ml-auto'>
          <FavoriteRemoveButton favoriteId={favoriteId} />
        </div>
      ) : null}
    </div>
  )
}
