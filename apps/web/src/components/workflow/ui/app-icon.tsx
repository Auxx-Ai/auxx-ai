// apps/web/src/components/workflow/ui/app-icon.tsx

'use client'

import {
  EntityIcon,
  type EntityIconProps,
  entityIconVariants,
  getIconColor,
} from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'

type IconType = 'lucide' | 'url' | 'base64' | 'emoji'

interface ParsedIcon {
  type: IconType
  value: string
}

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u

/** Parse an icon string to determine its type and extract its value. */
export function parseIconString(icon: string): ParsedIcon {
  if (icon.startsWith('url:')) {
    return { type: 'url', value: icon.slice(4) }
  }
  if (icon.startsWith('base64:')) {
    return { type: 'base64', value: icon.slice(7) }
  }
  if (icon.startsWith('https://') || icon.startsWith('http://')) {
    return { type: 'url', value: icon }
  }
  if (EMOJI_RE.test(icon)) {
    return { type: 'emoji', value: icon }
  }
  return { type: 'lucide', value: icon }
}

export interface AppIconProps extends EntityIconProps {}

/**
 * Extended icon component that handles Lucide icons, URLs, base64 images, and emojis.
 * For Lucide icons, delegates to EntityIcon. For other types, renders its own element
 * using the same variant/size styling from entityIconVariants.
 */
export function AppIcon({
  iconId,
  color,
  inverse = false,
  variant = 'default',
  size = 'default',
  style,
  className,
  ...props
}: AppIconProps) {
  const parsed = parseIconString(iconId)

  if (parsed.type === 'lucide') {
    return (
      <EntityIcon
        iconId={parsed.value}
        color={color}
        inverse={inverse}
        variant={variant}
        size={size}
        style={style}
        className={className}
        {...props}
      />
    )
  }

  const colorData = color ? getIconColor(color) : null
  const useColorClasses = !style && colorData

  const wrapperClassName = cn(
    entityIconVariants({ variant, size }),
    useColorClasses && (inverse ? colorData?.inverseColor : colorData?.bgClasses),
    className
  )

  if (parsed.type === 'url' || parsed.type === 'base64') {
    return (
      <div className={wrapperClassName} style={style} {...props}>
        <img src={parsed.value} alt='' className='size-full object-contain' draggable={false} />
      </div>
    )
  }

  // emoji
  return (
    <div className={wrapperClassName} style={style} {...props}>
      <span className='leading-none'>{parsed.value}</span>
    </div>
  )
}
