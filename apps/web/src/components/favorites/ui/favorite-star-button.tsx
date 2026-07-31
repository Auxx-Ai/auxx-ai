// apps/web/src/components/favorites/ui/favorite-star-button.tsx
'use client'

import type { FavoriteTargetIdsMap, FavoriteTargetType } from '@auxx/lib/favorites/client'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { Star } from 'lucide-react'
import { useFavoriteToggle } from '../hooks/use-favorite-toggle'

interface Props<T extends FavoriteTargetType> extends Omit<ButtonProps, 'onClick' | 'children'> {
  targetType: T
  targetIds: FavoriteTargetIdsMap[T]
  /** Tailwind class(es) that reveal the button on hover of an ancestor group
   *  (e.g. 'group-hover/kb-item:flex') when not favorited. Omit to always show. */
  revealOnHoverClassName?: string
  /**
   * Key hint shown in the tooltip. Only pass it where the key is actually bound
   * — this button appears in a dozen places and only the record surfaces bind
   * `F`. A hint for a key that does nothing here is worse than no hint.
   */
  shortcut?: string
}

/** Reusable favorite/unfavorite star toggle for any favoritable target. */
export function FavoriteStarButton<T extends FavoriteTargetType>({
  targetType,
  targetIds,
  className,
  revealOnHoverClassName,
  shortcut,
  ...props
}: Props<T>) {
  const { toggle, isFavorited, isPending } = useFavoriteToggle(targetType, targetIds)

  return (
    <SimpleTooltip
      content={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      shortcut={shortcut}>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        disabled={isPending}
        className={cn(
          isFavorited || !revealOnHoverClassName ? 'flex' : cn('hidden', revealOnHoverClassName),
          className
        )}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!isPending) toggle()
        }}
        {...props}>
        <Star className={isFavorited ? 'fill-amber-400 text-amber-500' : undefined} />
      </Button>
    </SimpleTooltip>
  )
}
