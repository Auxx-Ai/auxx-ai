// apps/web/src/components/favorites/ui/kb-favorite-star-button.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Star } from 'lucide-react'
import { useFavoriteToggle } from '../hooks/use-favorite-toggle'

export function KBFavoriteStarButton({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { toggle, isFavorited, isPending } = useFavoriteToggle('KNOWLEDGE_BASE', {
    knowledgeBaseId,
  })

  return (
    <button
      type='button'
      aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      disabled={isPending}
      className={cn(
        'size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent',
        isFavorited ? 'flex' : 'hidden group-hover/kb-item:flex'
      )}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!isPending) toggle()
      }}>
      <Star
        className={cn(
          'size-3',
          isFavorited ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'
        )}
      />
    </button>
  )
}
