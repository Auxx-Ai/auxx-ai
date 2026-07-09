// apps/web/src/components/favorites/ui/private-item.tsx
'use client'

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { BookmarkX, Lock } from 'lucide-react'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { useRemoveFavorite } from '../hooks/use-remove-favorite'

/**
 * Rendered when a favorite's target can't be resolved — it was deleted, is no
 * longer accessible (404 / 403), or never finished loading. Always removable.
 */
export function PrivateItem({ favoriteId }: { favoriteId: string }) {
  const handleRemove = useRemoveFavorite(favoriteId)

  const editItems = (
    <DropdownMenuItem onClick={handleRemove}>
      <BookmarkX />
      Remove from favorites
    </DropdownMenuItem>
  )

  return (
    <SidebarItem
      id={favoriteId}
      name='Unavailable'
      href='#'
      icon={<Lock />}
      isSubmenu
      editItems={editItems}
      className='text-muted-foreground italic'
    />
  )
}
