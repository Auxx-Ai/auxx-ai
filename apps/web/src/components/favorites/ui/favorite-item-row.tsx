// apps/web/src/components/favorites/ui/favorite-item-row.tsx
'use client'

import type { ReactNode } from 'react'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { FavoriteRemoveButton } from './favorite-remove-button'

interface FavoriteItemRowProps {
  favoriteId: string
  href: string
  icon?: ReactNode
  title: string
  subtitle?: string
  isActive?: boolean
}

/** Thin wrapper around SidebarItem that adds a "Remove from favorites" action. */
export function FavoriteItemRow({ favoriteId, href, icon, title, isActive }: FavoriteItemRowProps) {
  return (
    <SidebarItem
      id={favoriteId}
      name={title}
      href={href}
      icon={icon}
      isSubmenu
      isActive={isActive}
      action={<FavoriteRemoveButton favoriteId={favoriteId} />}
    />
  )
}
