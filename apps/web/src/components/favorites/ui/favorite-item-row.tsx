// apps/web/src/components/favorites/ui/favorite-item-row.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { BookmarkX } from 'lucide-react'
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

  const action = (
    <Button
      variant='ghost'
      size='icon'
      aria-label='Remove from favorites'
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        handleRemove()
      }}
      className={cn(
        'size-6 shrink-0 rounded-md opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100',
        'hover:bg-primary-200/50 hover:text-foreground/50 focus-visible:ring-primary/10'
      )}>
      <BookmarkX className='size-3.5' />
    </Button>
  )

  return (
    <SidebarItem
      id={favoriteId}
      name={title}
      href={href}
      icon={icon}
      isSubmenu
      isActive={isActive}
      action={action}
      className={subtitle ? '' : ''}
    />
  )
}
