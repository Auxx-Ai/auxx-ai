// apps/web/src/components/apps/ui/app-icon.tsx

'use client'

import type { EntityIconProps } from '@auxx/ui/components/icons'
import { VisualIcon } from '~/components/icons/ui/visual-icon'

export interface AppIconProps extends EntityIconProps {}

/**
 * Logo-semantics preset over VisualIcon: `iconId` carries the full visual-ref grammar
 * (lucide, `brand:`, `url:`, `base64:`, http(s), emoji, `color:`, `icon:`); images render
 * object-contain and `color` tints the frame of any branch.
 */
export function AppIcon({ iconId, ...props }: AppIconProps) {
  return <VisualIcon value={iconId} fit='contain' {...props} />
}
