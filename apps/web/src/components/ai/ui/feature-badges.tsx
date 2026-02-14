// apps/web/src/app/(protected)/app/settings/aiModels/_components/feature-badges.tsx

'use client'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { FEATURE_BADGES, formatContextLength } from './utils'

interface FeatureBadgesProps {
  features: string[]
  contextLength?: number
  className?: string
  maxVisible?: number
}

/**
 * Component to display model features as badges
 */
export const FeatureBadges: React.FC<FeatureBadgesProps> = ({
  features,
  contextLength,
  className,
  maxVisible = 3,
}) => {
  const visibleFeatures = features.slice(0, maxVisible)
  const remainingCount = Math.max(0, features.length - maxVisible)

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {/* Feature badges */}
      {visibleFeatures.map((feature) => {
        const config = FEATURE_BADGES[feature as keyof typeof FEATURE_BADGES]
        const label = config?.label || feature.charAt(0).toUpperCase() + feature.slice(1)

        return (
          <Badge key={feature} variant='outline' size='xs' className='opacity-50'>
            {label}
          </Badge>
        )
      })}

      {/* Remaining count indicator */}
      {remainingCount > 0 && (
        <Badge variant='outline' size='xs'>
          +{remainingCount}
        </Badge>
      )}

      {/* Context length badge */}
      {contextLength && contextLength > 0 && (
        <Badge variant='outline' size='xs' className='font-mono bg-muted/20'>
          {formatContextLength(contextLength)}
        </Badge>
      )}
    </div>
  )
}

interface ContextLengthBadgeProps {
  contextLength: number
  className?: string
}

/**
 * Standalone context length badge component
 */
export const ContextLengthBadge: React.FC<ContextLengthBadgeProps> = ({
  contextLength,
  className,
}) => {
  if (contextLength <= 0) return null

  return (
    <Badge variant='outline' className={cn('text-xs px-2 py-0.5 font-mono bg-muted/50', className)}>
      {formatContextLength(contextLength)}
    </Badge>
  )
}
