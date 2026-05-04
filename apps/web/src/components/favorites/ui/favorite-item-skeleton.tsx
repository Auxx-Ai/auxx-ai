// apps/web/src/components/favorites/ui/favorite-item-skeleton.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'

export function FavoriteItemSkeleton() {
  return (
    <div className='flex h-7 w-full items-center px-2'>
      <Skeleton className='size-4 mr-2 shrink-0 rounded-sm' />
      <Skeleton className='h-3 w-24' />
    </div>
  )
}
