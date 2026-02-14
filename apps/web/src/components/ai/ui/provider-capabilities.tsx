// apps/web/src/app/(protected)/app/settings/aiModels/_components/provider-capabilities.tsx

'use client'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import type React from 'react'
import { FEATURE_BADGES } from './utils'

interface ProviderCapabilitiesProps {
  capabilities: string[]
  modelCount: number
  className?: string
  maxCapabilities?: number
}

/**
 * Component to display provider capabilities summary
 */
export const ProviderCapabilities: React.FC<ProviderCapabilitiesProps> = ({
  capabilities,
  modelCount,
  className,
  maxCapabilities = 4,
}) => {
  const visibleCapabilities = capabilities.slice(0, maxCapabilities)
  const remainingCount = Math.max(0, capabilities.length - maxCapabilities)

  const formatCapabilityName = (capability: string, index: number): string => {
    const config = FEATURE_BADGES[capability as keyof typeof FEATURE_BADGES]
    const cap = config?.label || capability.charAt(0).toUpperCase() + capability.slice(1)

    return (
      <Badge key={index} size='xs' variant='pill' className='truncate'>
        {cap}
      </Badge>
    )
  }

  const capabilityEls = visibleCapabilities.map(formatCapabilityName)
  const remaining = remainingCount > 0 ? ` +${remainingCount} more` : ''
  const modelText = modelCount === 1 ? '1 model' : `${modelCount} models`

  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      <span className='inline-flex items-center gap-1'>
        {capabilityEls && (
          <>
            <span className='gap-1 flex flex-row items-center'>
              {capabilityEls}
              {remaining}
            </span>
            <span className='text-muted-foreground/60 hidden @3xl:flex'>•</span>
          </>
        )}
        <span className='font-medium truncate hidden @3xl:flex'>{modelText}</span>
      </span>
    </div>
  )
}

interface ProviderSummaryProps {
  capabilities: string[]
  modelCount: number
  className?: string
}

/**
 * Compact provider summary for collapsed view
 */
export const ProviderSummary: React.FC<ProviderSummaryProps> = ({
  capabilities,
  modelCount,
  className,
}) => {
  if (capabilities.length === 0 && modelCount === 0) {
    return <div className={cn('text-sm text-muted-foreground', className)}>No models available</div>
  }

  return (
    <ProviderCapabilities
      capabilities={capabilities}
      modelCount={modelCount}
      className={className}
      maxCapabilities={3}
    />
  )
}
