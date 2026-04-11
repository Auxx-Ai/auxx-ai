// apps/web/src/components/resources/ui/record-icon.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { EntityIcon, type EntityIconProps, entityIconVariants } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'

interface RecordIconProps extends Omit<EntityIconProps, 'style'> {
  /** Avatar URL from EntityInstance.avatarUrl */
  avatarUrl?: string | null
}

/**
 * Renders a record's visual identity: avatar image when available,
 * EntityIcon fallback otherwise. Uses the same shape, size, and color
 * styling as EntityIcon so avatars visually match entity icons.
 * Shows EntityIcon as fallback while the image loads or if it fails.
 */
export function RecordIcon({
  avatarUrl,
  iconId,
  color,
  inverse = false,
  variant = 'default',
  size = 'default',
  className,
  ...props
}: RecordIconProps) {
  if (avatarUrl) {
    return (
      <Avatar
        className={cn(
          entityIconVariants({ variant, size }),
          'overflow-hidden inset-shadow-xs inset-shadow-black/20',
          className
        )}
        {...props}>
        <AvatarImage src={avatarUrl} className='object-cover' />
        <AvatarFallback className='size-full'>
          <EntityIcon
            iconId={iconId}
            color={color}
            size={size}
            inverse={inverse}
            className={cn(className, 'inset-shadow-xs inset-shadow-black/20')}
          />
        </AvatarFallback>
      </Avatar>
    )
  }

  return (
    <EntityIcon
      iconId={iconId}
      color={color}
      inverse={inverse}
      variant={variant}
      size={size}
      className={cn(className, 'inset-shadow-xs inset-shadow-black/20')}
      {...props}
    />
  )
}
