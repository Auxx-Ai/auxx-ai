// apps/web/src/components/favorites/ui/sortable-favorite-row.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { SidebarMenuSubItem } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FavoriteItemDispatch } from './favorite-item'

interface Props {
  favorite: FavoriteEntity
  parentFolderId: string | null
  index: number
}

/**
 * Whole-row draggable wrapper. Listeners apply to the entire <li>; the global
 * PointerSensor's distance: 8 activation constraint preserves click-to-navigate.
 */
export function SortableFavoriteRow({ favorite, parentFolderId, index }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `favorite-row-${favorite.id}`,
    data: {
      type: 'favorite',
      favoriteId: favorite.id,
      nodeType: favorite.nodeType,
      parentFolderId,
      index,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <SidebarMenuSubItem
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn('list-none', isDragging && 'opacity-40')}>
      <FavoriteItemDispatch favorite={favorite} />
    </SidebarMenuSubItem>
  )
}
