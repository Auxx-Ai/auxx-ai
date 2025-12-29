// ~/components/global/integration-status-indicator.tsx
'use client'

import React from 'react'
import { Badge } from '@auxx/ui/components/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { Clock } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { useIsSmallScreen } from '~/hooks/use-small-screen'
import { integrationStatusConfig } from '../mail/mail-status-config'

type IntegrationStatus = 'authenticated' | 'auth_error' | 'sync_error' | 'disabled' | 'syncing'

interface IntegrationStatusIndicatorProps {
  status: IntegrationStatus
  lastSyncAt?: Date
  lastError?: string
  className?: string
  showLabel?: boolean
  size?: 'sm' | 'default' | 'lg'
}

/**
 * Integration status indicator with mobile-first design
 * Shows authentication and sync status with appropriate icons and colors
 */
export function IntegrationStatusIndicator({
  status,
  lastSyncAt,
  lastError,
  className,
  showLabel = true,
  size = 'default',
}: IntegrationStatusIndicatorProps) {
  const isSmallScreen = useIsSmallScreen()

  // Get config from centralized configuration
  const baseConfig = integrationStatusConfig[status] || {
    icon: Clock,
    label: 'Unknown',
    variant: 'secondary' as const,
    color: 'text-gray-500 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    description: 'Status unknown',
  }

  // Override description with dynamic values if needed
  const config = {
    ...baseConfig,
    description:
      status === 'authenticated' && lastSyncAt
        ? `Last synced ${formatRelativeTime(lastSyncAt)}`
        : status === 'auth_error' && lastError
          ? lastError
          : status === 'sync_error' && lastError
            ? lastError
            : baseConfig.description,
  }
  const Icon = config.icon

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return { badge: 'text-xs px-2 py-0.5', icon: 'h-3 w-3', gap: 'gap-1' }
      case 'lg':
        return { badge: 'text-sm px-3 py-1', icon: 'h-5 w-5', gap: 'gap-2' }
      default:
        return { badge: 'text-xs px-2 py-1', icon: 'h-4 w-4', gap: 'gap-1.5' }
    }
  }

  const sizeClasses = getSizeClasses()

  // Mobile: Always show icon-only for space efficiency
  if (isSmallScreen && size !== 'lg') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'inline-flex items-center justify-center rounded-full p-1',
                config.bgColor,
                className
              )}>
              <Icon
                className={cn(
                  config.color,
                  sizeClasses.icon,
                  status === 'syncing' && 'animate-spin'
                )}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="text-center">
              <div className="font-medium">{config.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{config.description}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Desktop or large size: Show full badge
  const content = (
    <Badge
      variant={config.variant}
      size="sm"
      className={cn(
        'inline-flex items-center font-medium',
        sizeClasses.badge,
        sizeClasses.gap,
        className
      )}>
      <Icon className={cn(sizeClasses.icon, status === 'syncing' && 'animate-spin')} />
      {showLabel && <span className="truncate">{config.label}</span>}
    </Badge>
  )

  // Wrap with tooltip for additional context
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div>
            <div className="font-medium">{config.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{config.description}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Format relative time for last sync
 */
function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
  } else {
    return 'just now'
  }
}

/**
 * Helper function to determine status from integration data
 */
export function getIntegrationStatus(integration: {
  enabled: boolean
  requiresReauth?: boolean
  lastAuthError?: string
  lastSyncedAt?: Date
  isSyncing?: boolean
}): IntegrationStatus {
  if (!integration.enabled) {
    return 'disabled'
  }

  if (integration.isSyncing) {
    return 'syncing'
  }

  if (integration.requiresReauth || integration.lastAuthError) {
    return 'auth_error'
  }

  // Add sync error detection logic based on your sync status tracking
  // This would require additional fields in the Integration model

  return 'authenticated'
}
