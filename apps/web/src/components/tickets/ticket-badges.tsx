// components/tickets/ticket-badges.tsx
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Maps ticket status to Badge color variant
 */
const statusVariantMap: Record<string, Variant> = {
  OPEN: 'blue',
  IN_PROGRESS: 'yellow',
  WAITING_FOR_CUSTOMER: 'purple',
  WAITING_FOR_THIRD_PARTY: 'indigo',
  RESOLVED: 'green',
  CLOSED: 'gray',
  CANCELLED: 'red',
}

interface TicketStatusBadgeProps {
  status: string
  closed?: boolean
}

export function TicketStatusBadge({ status, closed }: TicketStatusBadgeProps) {
  const displayStatus = status.replace(/_/g, ' ')
  const variant = statusVariantMap[status] || 'gray'

  return (
    <div className={cn('flex inline-flex', { 'opacity-50': closed })}>
      <Badge variant={variant}>{displayStatus}</Badge>
    </div>
  )
}

/**
 * Maps ticket priority to Badge color variant
 */
const priorityVariantMap: Record<string, Variant> = {
  LOW: 'green',
  MEDIUM: 'blue',
  HIGH: 'orange',
  URGENT: 'red',
}

interface TicketPriorityBadgeProps {
  priority: string
  closed?: boolean
}

export function TicketPriorityBadge({ priority, closed }: TicketPriorityBadgeProps) {
  const variant = priorityVariantMap[priority] || 'blue'

  return (
    <div className={cn('flex inline-flex', { 'opacity-50': closed })}>
      <Badge size='default' variant={variant}>
        {priority}
      </Badge>
    </div>
  )
}

/**
 * Maps ticket type to Badge color variant
 */
const typeVariantMap: Record<string, Variant> = {
  GENERAL: 'gray',
  MISSING_ITEM: 'amber',
  RETURN: 'cyan',
  REFUND: 'lime',
  PRODUCT_ISSUE: 'violet',
  SHIPPING_ISSUE: 'teal',
  BILLING: 'emerald',
  TECHNICAL: 'indigo',
  OTHER: 'zinc',
}

interface TicketTypeBadgeProps {
  type: string
  closed?: boolean
}

export function TicketTypeBadge({ type, closed }: TicketTypeBadgeProps) {
  const displayType = type.replace(/_/g, ' ')
  const variant = typeVariantMap[type] || 'gray'

  return (
    <div className={cn('flex inline-flex', { 'opacity-50': closed })}>
      <Badge variant={variant}>{displayType}</Badge>
    </div>
  )
}
