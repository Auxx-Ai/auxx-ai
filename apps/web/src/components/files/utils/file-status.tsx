// apps/web/src/components/files/utils/file-status.tsx

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { AlertCircle, Ban, CheckCircle, Clock, Loader2, Trash2, XCircle } from 'lucide-react'

/**
 * File status types used throughout the application
 */
export type FileStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deleting'
  | 'ready'

/**
 * Status configuration interface
 */
interface StatusConfig {
  label: string
  color: string
  icon: typeof Clock
  bgColor: string
  borderColor: string
  textColor: string
  animate?: boolean
  variant: Variant
}

/**
 * Configuration for each file status
 */
export const STATUS_CONFIG: Record<FileStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    color: 'gray',
    icon: Clock,
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-600',
    variant: 'outline',
  },
  uploading: {
    label: 'Uploading',
    color: 'blue',
    icon: Loader2,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-600',
    animate: true,
    variant: 'outline',
  },
  processing: {
    label: 'Processing',
    color: 'blue',
    icon: Loader2,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-600',
    animate: true,
    variant: 'outline',
  },
  completed: {
    label: 'Completed',
    color: 'green',
    icon: CheckCircle,
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-600',
    variant: 'green',
  },
  failed: {
    label: 'Failed',
    color: 'red',
    icon: XCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-600',
    variant: 'red',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'gray',
    icon: Ban,
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-600',
    variant: 'gray',
  },
  deleting: {
    label: 'Deleting',
    color: 'gray',
    icon: Trash2,
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-600',
    animate: true,
    variant: 'outline',
  },
  ready: {
    label: 'Ready',
    color: 'gray',
    icon: AlertCircle,
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-600',
    variant: 'outline',
  },
}

/**
 * Props for FileStatusDisplay component
 */
interface FileStatusDisplayProps {
  status: FileStatus
  variant?: 'badge' | 'icon' | 'both'
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

/**
 * Component to display file status with configurable appearance
 */
export function FileStatusDisplay({
  status,
  variant = 'both',
  size = 'md',
  showLabel = true,
  className,
}: FileStatusDisplayProps) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon

  const sizeClasses = {
    sm: 'size-3',
    md: 'size-4',
    lg: 'size-5',
  }

  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  }

  // Icon-only variant
  if (variant === 'icon') {
    return (
      <Icon
        className={cn(
          sizeClasses[size],
          config.textColor,
          config.animate && 'animate-spin',
          className
        )}
      />
    )
  }

  // Badge-only variant
  if (variant === 'badge') {
    return (
      <Badge
        variant={config.variant}
        className={cn(
          textSizeClasses[size],
          // config.bgColor,
          // config.borderColor,
          // config.textColor,
          className
        )}>
        {showLabel && config.label}
      </Badge>
    )
  }

  // Both icon and badge
  return (
    <Badge
      variant={config.variant}
      className={cn(
        'flex items-center gap-1',
        textSizeClasses[size],
        config.bgColor,
        config.borderColor,
        config.textColor,
        className
      )}>
      <Icon className={cn(sizeClasses[size], config.animate && 'animate-spin')} />
      {showLabel && <span>{config.label}</span>}
    </Badge>
  )
}

/**
 * Get status configuration for a given status
 */
export function getStatusConfig(status: FileStatus): StatusConfig {
  return STATUS_CONFIG[status]
}

/**
 * Check if status indicates active operation (loading state)
 */
export function isActiveStatus(status: FileStatus): boolean {
  return ['uploading', 'processing', 'deleting'].includes(status)
}

/**
 * Check if status allows retry action
 */
export function canRetryStatus(status: FileStatus): boolean {
  return ['failed', 'cancelled'].includes(status)
}

/**
 * Check if status allows cancel action
 */
export function canCancelStatus(status: FileStatus): boolean {
  return ['uploading', 'processing', 'pending'].includes(status)
}

/**
 * Check if status indicates successful completion
 */
export function isSuccessStatus(status: FileStatus): boolean {
  return status === 'completed'
}

/**
 * Check if status indicates an error state
 */
export function isErrorStatus(status: FileStatus): boolean {
  return status === 'failed'
}
