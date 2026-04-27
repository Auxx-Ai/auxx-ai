// apps/web/src/components/favorites/ui/favorite-item-row.tsx
'use client'

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { api } from '~/trpc/react'
import { useFavoritesStore } from '../store/favorites-store'

interface FavoriteItemRowProps {
  favoriteId: string
  href: string
  icon?: ReactNode
  title: string
  subtitle?: string
  isActive?: boolean
}

/** Thin wrapper around SidebarItem that adds a "Remove from favorites" action. */
export function FavoriteItemRow({
  favoriteId,
  href,
  icon,
  title,
  subtitle,
  isActive,
}: FavoriteItemRowProps) {
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
      name={title}
      href={href}
      icon={icon}
      isSubmenu
      isActive={isActive}
      editItems={editItems}
      className={subtitle ? '' : ''}
    />
  )
}
