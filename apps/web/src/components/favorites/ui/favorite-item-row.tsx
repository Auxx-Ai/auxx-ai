// apps/web/src/components/favorites/ui/favorite-item-row.tsx
'use client'

import type { ReactNode } from 'react'
import { SidebarNavItem } from '~/components/global/sidebar/sidebar-nav-item'
import { FavoriteRemoveButton } from './favorite-remove-button'

interface FavoriteItemRowProps {
  favoriteId: string
  href: string
  icon?: ReactNode
  title: string
  subtitle?: string
  isActive?: boolean
}

/** Thin wrapper around SidebarNavItem that adds a "Remove from favorites" action. */
export function FavoriteItemRow({ favoriteId, href, icon, title, isActive }: FavoriteItemRowProps) {
  return (
    <SidebarNavItem
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
