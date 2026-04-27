// apps/web/src/components/favorites/ui/private-item.tsx
'use client'

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { Lock, Star } from 'lucide-react'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { api } from '~/trpc/react'
import { useFavoritesStore } from '../store/favorites-store'

/** Rendered when a favorite's target is not accessible (404 / 403). */
export function PrivateItem({ favoriteId }: { favoriteId: string }) {
  const removeById = useFavoritesStore((s) => s.removeById)
  const utils = api.useUtils()
  const removeMutation = api.favorite.remove.useMutation({
    onSuccess: () => void utils.favorite.list.invalidate(),
  })

  const handleRemove = () => {
    removeById(favoriteId)
    removeMutation.mutate({ favoriteId })
  }

  const editItems = (
    <DropdownMenuItem onClick={handleRemove}>
      <Star />
      Remove from favorites
    </DropdownMenuItem>
  )

  return (
    <SidebarItem
      id={favoriteId}
      name='Private item'
      href='#'
      icon={<Lock />}
      isSubmenu
      editItems={editItems}
      className='text-muted-foreground italic'
    />
  )
}
