// apps/web/src/components/favorites/ui/favorite-drag-overlay.tsx
'use client'

import { Folder, Star } from 'lucide-react'
import { useFavoritesStore } from '../store/favorites-store'

/**
 * Lightweight visual ghost rendered by dnd-kit's DragOverlay while a favorite
 * is being dragged. We deliberately don't reuse FavoriteItemDispatch — its
 * lazy-fetch hooks would re-fire and flicker a skeleton.
 */
export function FavoriteDragOverlay({ favoriteId }: { favoriteId: string }) {
  const favorite = useFavoritesStore((s) => s.byId[favoriteId])
  if (!favorite) return null

  const Icon = favorite.nodeType === 'FOLDER' ? Folder : Star
  const label = favorite.nodeType === 'FOLDER' ? (favorite.title ?? 'Folder') : 'Favorite'

  return (
    <div className='inline-flex max-w-xs items-center gap-2 rounded-md border bg-popover px-2 py-1 text-sm shadow-md'>
      <Icon className='size-3.5 shrink-0 text-muted-foreground' />
      <span className='truncate'>{label}</span>
    </div>
  )
}
