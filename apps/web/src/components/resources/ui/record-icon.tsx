// apps/web/src/components/resources/ui/record-icon.tsx
'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { EntityIcon, type EntityIconProps, entityIconVariants } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'

interface RecordIconProps extends Omit<EntityIconProps, 'style'> {
  /** Encoded visual ref from EntityInstance.avatarUrl — URL, base64, emoji, color:, icon:, or bare lucide id */
  avatarUrl?: string | null
}

type VisualRef =
  | { type: 'url'; value: string }
  | { type: 'base64'; value: string }
  | { type: 'emoji'; value: string }
  | { type: 'color'; color: string }
  | { type: 'icon'; iconId: string; color?: string }
  | { type: 'lucide'; value: string }

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u

/** Parse the polymorphic visual-ref grammar stored in EntityInstance.avatarUrl. */
function parseVisualRef(s: string | null | undefined): VisualRef | null {
  if (!s) return null
  if (s.startsWith('url:')) return { type: 'url', value: s.slice(4) }
  if (s.startsWith('base64:')) return { type: 'base64', value: s.slice(7) }
  if (s.startsWith('color:')) return { type: 'color', color: s.slice(6) }
  if (s.startsWith('icon:')) {
    const [iconId, color] = s.slice(5).split(':')
    return { type: 'icon', iconId: iconId ?? '', color: color || undefined }
  }
  if (s.startsWith('http://') || s.startsWith('https://')) return { type: 'url', value: s }
  if (EMOJI_RE.test(s)) return { type: 'emoji', value: s }
  return { type: 'lucide', value: s }
}

/**
 * Renders a record's visual identity using the polymorphic visual-ref grammar
 * stored in EntityInstance.avatarUrl. Falls back to the EntityDefinition's
 * iconId/color when avatarUrl is null or only carries a bare lucide id.
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
  const ref = parseVisualRef(avatarUrl)

  if (ref?.type === 'url' || ref?.type === 'base64') {
    return (
      <Avatar
        className={cn(
          entityIconVariants({ variant, size }),
          'overflow-hidden inset-shadow-xs inset-shadow-black/20',
          className
        )}
        {...props}>
        <AvatarImage src={ref.value} className='object-cover' />
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

  if (ref?.type === 'emoji') {
    return (
      <div
        className={cn(
          entityIconVariants({ variant, size }),
          'inset-shadow-xs inset-shadow-black/20',
          className
        )}
        {...props}>
        <span className='leading-none'>{ref.value}</span>
      </div>
    )
  }

  if (ref?.type === 'color') {
    return (
      <div
        className={cn(
          entityIconVariants({ variant, size }),
          getColorSwatch(ref.color),
          'inset-shadow-xs inset-shadow-black/20',
          className
        )}
        {...props}
      />
    )
  }

  const resolvedIconId =
    ref?.type === 'icon' ? ref.iconId : ref?.type === 'lucide' ? ref.value : iconId
  const resolvedColor = ref?.type === 'icon' ? (ref.color ?? color) : color

  return (
    <EntityIcon
      iconId={resolvedIconId}
      color={resolvedColor}
      inverse={inverse}
      variant={variant}
      size={size}
      className={cn(className, 'inset-shadow-xs inset-shadow-black/20')}
      {...props}
    />
  )
}
