// apps/web/src/components/icons/ui/visual-icon.tsx
'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import {
  EntityIcon,
  type EntityIconProps,
  entityIconVariants,
  getIconColor,
} from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { BRAND_ICONS, type BrandSlug } from '../brands'

export type VisualRef =
  | { type: 'url'; value: string }
  | { type: 'base64'; value: string }
  | { type: 'emoji'; value: string }
  | { type: 'color'; color: string }
  | { type: 'icon'; iconId: string; color?: string }
  | { type: 'brand'; slug: string }
  | { type: 'lucide'; value: string }

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u

/**
 * Parse the polymorphic visual-ref grammar used across the app (EntityInstance.avatarUrl,
 * McpServer.icon.iconId, app/agent icons): explicit prefixes (`brand:`, `url:`, `base64:`,
 * `color:`, `icon:<id>[:<color>]`), raw http(s) URLs, emojis, or a bare Lucide icon id.
 */
export function parseVisualRef(s: string | null | undefined): VisualRef | null {
  if (!s) return null
  if (s.startsWith('brand:')) return { type: 'brand', slug: s.slice(6) }
  if (s.startsWith('url:')) return { type: 'url', value: s.slice(4) }
  if (s.startsWith('base64:')) return { type: 'base64', value: s.slice(7) }
  if (s.startsWith('color:')) return { type: 'color', color: s.slice(6) }
  if (s.startsWith('icon:')) {
    const [iconId, color] = s.slice(5).split(':')
    return { type: 'icon', iconId: iconId ?? '', color: color || undefined }
  }
  // Anything an <img src> can render directly is a url ref. `blob:` covers the
  // optimistic preview an in-flight avatar upload writes to the record store,
  // `data:` the inline form of base64, and a leading `/` the same-origin
  // `/api/files/download/<ref>` URL a just-saved FILE field resolves to. Missing
  // any of these fell through to the `lucide` branch below, where an unknown
  // icon id makes EntityIcon render `null` — the whole avatar frame disappeared
  // mid-upload instead of showing the picked image.
  if (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('blob:') ||
    s.startsWith('data:') ||
    s.startsWith('/')
  ) {
    return { type: 'url', value: s }
  }
  if (EMOJI_RE.test(s)) return { type: 'emoji', value: s }
  return { type: 'lucide', value: s }
}

/** Public path of a brand mark in `apps/web/public/icons/brands/`. */
export function brandIconSrc(slug: string, dark = false): string {
  return `/icons/brands/${slug}${dark ? '-dark' : ''}.svg`
}

export interface VisualIconProps extends Omit<EntityIconProps, 'iconId'> {
  /** Encoded visual ref (any grammar handled by `parseVisualRef`). */
  value?: string | null
  /** Identity fallback when value is empty — also the AvatarFallback for failed images. */
  fallbackIconId?: string
  /** Color for the fallback identity only (never tints image/emoji frames). */
  fallbackColor?: string
  /** Image fit for url/base64 refs: 'contain' (logos) | 'cover' (avatars). */
  fit?: 'contain' | 'cover'
  /** Render url/base64 refs via Avatar with the fallback identity behind them. */
  imageFallback?: boolean
  /** Extra frame classes (e.g. RecordIcon's inset shadow), merged into entityIconVariants. */
  frameClassName?: string
}

/**
 * Universal icon renderer behind `AppIcon` (logo semantics) and `RecordIcon` (avatar
 * semantics). `color` tints the frame of any branch (AppIcon behavior); `fallbackColor`
 * only colors the EntityIcon fallback identity (RecordIcon behavior).
 */
export function VisualIcon({
  value,
  fallbackIconId,
  fallbackColor,
  fit = 'contain',
  imageFallback = false,
  frameClassName,
  color,
  inverse = false,
  variant = 'default',
  size = 'default',
  style,
  className,
  ...props
}: VisualIconProps) {
  const ref = parseVisualRef(value)

  if (!ref || ref.type === 'lucide' || ref.type === 'icon') {
    const iconId =
      ref?.type === 'icon'
        ? ref.iconId
        : ref?.type === 'lucide'
          ? ref.value
          : (fallbackIconId ?? '')
    const resolvedColor =
      ref?.type === 'icon' ? (ref.color ?? color ?? fallbackColor) : (color ?? fallbackColor)
    return (
      <EntityIcon
        iconId={iconId}
        color={resolvedColor}
        inverse={inverse}
        variant={variant}
        size={size}
        style={style}
        className={cn(frameClassName, className)}
        {...props}
      />
    )
  }

  const colorData = color ? getIconColor(color) : null
  const useColorClasses = !style && colorData
  const frame = cn(
    entityIconVariants({ variant, size }),
    useColorClasses && (inverse ? colorData?.inverseColor : colorData?.bgClasses),
    frameClassName,
    className
  )

  if (ref.type === 'brand') {
    const hasDark = BRAND_ICONS[ref.slug as BrandSlug]?.hasDark ?? false
    return (
      <div className={frame} style={style} {...props}>
        <img
          src={brandIconSrc(ref.slug)}
          alt=''
          className={cn('object-contain', hasDark && 'dark:hidden')}
          draggable={false}
        />
        {hasDark && (
          <img
            src={brandIconSrc(ref.slug, true)}
            alt=''
            className='hidden object-contain dark:block'
            draggable={false}
          />
        )}
      </div>
    )
  }

  if (ref.type === 'url' || ref.type === 'base64') {
    const fitClass = fit === 'cover' ? 'object-cover' : 'object-contain'
    if (imageFallback) {
      return (
        <Avatar className={cn(frame, 'overflow-hidden')} {...props}>
          <AvatarImage src={ref.value} className={fitClass} />
          <AvatarFallback className='size-full'>
            <EntityIcon
              iconId={fallbackIconId ?? ''}
              color={fallbackColor ?? color}
              size={size}
              inverse={inverse}
              className={cn(className, frameClassName)}
            />
          </AvatarFallback>
        </Avatar>
      )
    }
    return (
      <div className={frame} style={style} {...props}>
        <img src={ref.value} alt='' className={fitClass} draggable={false} />
      </div>
    )
  }

  if (ref.type === 'color') {
    return <div className={cn(frame, getColorSwatch(ref.color))} style={style} {...props} />
  }

  // emoji
  return (
    <div className={frame} style={style} {...props}>
      <span className='leading-none'>{ref.value}</span>
    </div>
  )
}
