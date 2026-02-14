// apps/web/src/components/datasets/documents/document-utils.tsx

import type { DocumentStatusType } from '@auxx/database/types'
import { Badge, type BadgeProps, type Variant } from '@auxx/ui/components/badge'
import { AlertCircle, Archive, CheckCircle, Clock, FileText, Upload } from 'lucide-react'

/**
 * Configuration for document status styling and icons
 */
const statusConfig: Record<
  DocumentStatusType,
  {
    Icon: typeof Upload
    variant: Variant
    colorClass: string
    bgColor: string
    textColor: string
    borderColor: string
  }
> = {
  UPLOADED: {
    Icon: Upload,
    variant: 'blue',
    colorClass: 'text-blue-600',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200',
  },
  PROCESSING: {
    Icon: Clock,
    variant: 'yellow',
    colorClass: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-200',
  },
  INDEXED: {
    Icon: CheckCircle,
    variant: 'green',
    colorClass: 'text-green-600',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200',
  },
  FAILED: {
    Icon: AlertCircle,
    variant: 'red',
    colorClass: 'text-red-600',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-200',
  },
  ARCHIVED: {
    Icon: Archive,
    variant: 'gray',
    colorClass: 'text-gray-600',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-800',
    borderColor: 'border-gray-200',
  },
  WAITING: {
    Icon: Clock,
    variant: 'amber',
    colorClass: 'text-amber-600',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-800',
    borderColor: 'border-amber-200',
  },
}
/**
 * Default configuration for unknown status
 */
const defaultConfig = {
  Icon: FileText,
  variant: 'gray' as Variant,
  colorClass: 'text-gray-600',
  bgColor: 'bg-gray-100',
  textColor: 'text-gray-800',
  borderColor: 'border-gray-200',
}
/**
 * Get the appropriate badge variant for a document status
 * @param status Document status
 * @returns Badge variant
 */
export const getStatusVariant = (status: DocumentStatusType): Variant => {
  return statusConfig[status]?.variant || defaultConfig.variant
}
/**
 * Get the appropriate icon for a document status
 * @param status Document status
 * @param className Optional CSS classes for the icon
 * @returns JSX element representing the status icon
 */
export const DocumentStatusIcon = ({
  status,
  className = 'size-4',
}: {
  status: DocumentStatusType
  className?: string
}) => {
  const config = statusConfig[status] || defaultConfig
  const { Icon, colorClass } = config
  return <Icon className={`${className} ${colorClass}`} />
}
export interface DocumentStatusProps extends Omit<BadgeProps, 'variant'> {
  /** Document status */
  status: DocumentStatusType
  /** CSS classes for the icon */
  iconClassName?: string
  /** Whether to show the status text */
  showText?: boolean
}
export const DocumentStatus = ({
  status,
  iconClassName = 'size-3',
  showText = true,
  className,
  ...props
}: DocumentStatusProps) => {
  const config = statusConfig[status] || defaultConfig
  const { Icon, colorClass } = config
  return (
    <Badge variant={getStatusVariant(status)} className={className} {...props}>
      <Icon className={`${iconClassName} ${colorClass} me-2`} />
      {showText && status.toLowerCase()}
    </Badge>
  )
}
/**
 * Get legacy status color classes for document status (for backwards compatibility)
 * @param status Document status
 * @returns CSS classes for status styling
 * @deprecated Use getStatusVariant instead for badge variants
 */
export const getStatusColor = (status: DocumentStatusType) => {
  const config = statusConfig[status] || defaultConfig
  return `${config.bgColor} ${config.textColor} ${config.borderColor}`
}
