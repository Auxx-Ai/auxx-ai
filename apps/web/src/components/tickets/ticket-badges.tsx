// components/tickets/ticket-badges.tsx
import { TicketPriority, TicketStatus, TicketType } from '@auxx/lib/resources/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'

/** Build a value → label lookup from enum .values array */
function toLabelMap(
  values: ReadonlyArray<{ value: string; label: string }>
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const v of values) map[v.value] = v.label
  return map
}

const statusLabels = toLabelMap(TicketStatus.values)
const typeLabels = toLabelMap(TicketType.values)
const priorityLabels = toLabelMap(TicketPriority.values)

const statusVariantMap: Record<string, Variant> = {
  OPEN: 'blue',
  IN_PROGRESS: 'yellow',
  WAITING_FOR_CUSTOMER: 'purple',
  WAITING_FOR_THIRD_PARTY: 'indigo',
  RESOLVED: 'green',
  CLOSED: 'gray',
  CANCELLED: 'red',
  MERGED: 'gray',
}

interface TicketStatusBadgeProps {
  status: string
  closed?: boolean
}

export function TicketStatusBadge({ status, closed }: TicketStatusBadgeProps) {
  if (!status) return null
  const label = statusLabels[status] ?? status
  const variant = statusVariantMap[status] || 'gray'

  return (
    <div className={cn('inline-flex max-w-full', { 'opacity-50': closed })}>
      <Badge variant={variant} className='truncate'>
        {label}
      </Badge>
    </div>
  )
}

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
  if (!priority) return null
  const label = priorityLabels[priority] ?? priority
  const variant = priorityVariantMap[priority] || 'blue'

  return (
    <div className={cn('inline-flex max-w-full', { 'opacity-50': closed })}>
      <Badge size='default' variant={variant} className='truncate'>
        {label}
      </Badge>
    </div>
  )
}

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
  if (!type) return null
  const label = typeLabels[type] ?? type
  const variant = typeVariantMap[type] || 'gray'

  return (
    <div className={cn('inline-flex max-w-full', { 'opacity-50': closed })}>
      <Badge variant={variant} className='truncate'>
        {label}
      </Badge>
    </div>
  )
}
