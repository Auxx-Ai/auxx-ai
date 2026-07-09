// apps/web/src/components/favorites/ui/favorite-remove-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { BookmarkX } from 'lucide-react'
import { useRemoveFavorite } from '../hooks/use-remove-favorite'

/** Ghost "Remove from favorites" icon button, revealed on row hover. */
export function FavoriteRemoveButton({ favoriteId }: { favoriteId: string }) {
  const remove = useRemoveFavorite(favoriteId)

  return (
    <Button
      variant='ghost'
      size='icon'
      aria-label='Remove from favorites'
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        remove()
      }}
      className={cn(
        'size-6 shrink-0 rounded-md opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100',
        'hover:bg-primary-200/50 hover:text-foreground/50 focus-visible:ring-primary/10'
      )}>
      <BookmarkX className='size-3.5' />
    </Button>
  )
}
