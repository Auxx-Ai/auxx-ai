// apps/web/src/components/favorites/ui/favorite-toggle-menu-item.tsx
'use client'

import type { FavoriteTargetIdsMap, FavoriteTargetType } from '@auxx/lib/favorites/client'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { Star, StarOff } from 'lucide-react'
import { useFavoriteToggle } from '../hooks/use-favorite-toggle'

interface Props<T extends FavoriteTargetType> {
  targetType: T
  targetIds: FavoriteTargetIdsMap[T]
  /** Optional preset label override; defaults derived from targetType. */
  addLabel?: string
  removeLabel?: string
}

export function FavoriteToggleMenuItem<T extends FavoriteTargetType>({
  targetType,
  targetIds,
  addLabel,
  removeLabel,
}: Props<T>) {
  const { toggle, isFavorited, isPending } = useFavoriteToggle(targetType, targetIds)

  return (
    <DropdownMenuItem
      onClick={(e) => {
        e.preventDefault()
        if (!isPending) toggle()
      }}>
      {isFavorited ? <StarOff /> : <Star />}
      {isFavorited ? (removeLabel ?? 'Remove from favorites') : (addLabel ?? 'Add to favorites')}
    </DropdownMenuItem>
  )
}
