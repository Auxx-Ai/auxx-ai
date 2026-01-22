// apps/web/src/components/timeline/status-badge.tsx
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for the StatusBadge component
 */
interface StatusBadgeProps {
  status: string
}

/**
 * Color mapping for different status values
 */
const STATUS_COLORS = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-700',
  SPAM: 'bg-red-100 text-red-700',
} as const

/**
 * Displays a colored badge for status values
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        STATUS_COLORS[status as keyof typeof STATUS_COLORS] || 'bg-gray-100 text-gray-700'
      )}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}
