// apps/web/src/components/resources/ui/record-icon.tsx
'use client'

import type { EntityIconProps } from '@auxx/ui/components/icons'
import { VisualIcon } from '~/components/icons/ui/visual-icon'

interface RecordIconProps extends Omit<EntityIconProps, 'style'> {
  /** Encoded visual ref from EntityInstance.avatarUrl — URL, base64, emoji, color:, icon:, brand:, or bare lucide id */
  avatarUrl?: string | null
}

/**
 * Avatar-semantics preset over VisualIcon: renders the visual ref stored in
 * EntityInstance.avatarUrl, falling back to the EntityDefinition's iconId/color when
 * avatarUrl is empty (or behind images that fail to load). Images render object-cover.
 */
export function RecordIcon({ avatarUrl, iconId, color, ...props }: RecordIconProps) {
  return (
    <VisualIcon
      value={avatarUrl}
      fallbackIconId={iconId}
      fallbackColor={color}
      fit='cover'
      imageFallback
      frameClassName='inset-shadow-xs inset-shadow-black/20'
      {...props}
    />
  )
}
