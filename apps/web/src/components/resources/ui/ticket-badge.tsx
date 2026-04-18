// apps/web/src/components/resources/ui/ticket-badge.tsx
'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { useRecord, useResource } from '~/components/resources'
import { recordBadgeVariants } from './record-badge'
import { RecordIcon } from './record-icon'

interface TicketBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** Ticket EntityInstance id (not RecordId). If undefined/null, renders the "Link ticket" empty state. */
  ticketId?: string | null
  /** Whether to show icon/avatar (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
  /** Label shown when no ticket is linked (default: "Link ticket") */
  emptyLabel?: string
}

/**
 * Badge that shows a linked ticket's number (e.g. "#2501-0042") or a
 * "Link ticket" empty state when no ticket is linked.
 *
 * Styled to match RecordBadge so it can be used interchangeably as a
 * RecordPicker trigger in both linked and unlinked states.
 */
export function TicketBadge({
  ticketId,
  showIcon = true,
  className,
  variant,
  size,
  emptyLabel = 'Link ticket',
}: TicketBadgeProps) {
  const recordId = ticketId ? toRecordId('ticket', ticketId) : null

  const { record, isLoading: isLoadingRecord } = useRecord({
    recordId,
    enabled: !!recordId,
  })
  const { resource, isLoading: isLoadingResource } = useResource('ticket')

  const isEmpty = !ticketId
  const isLoading = !isEmpty && (isLoadingRecord || isLoadingResource) && !record

  // Ticket number lives in secondaryInfo (DISPLAY_FIELD_CONFIG.ticket.secondaryDisplayField = 'number')
  const ticketNumber = record?.secondaryInfo

  return (
    <div
      data-slot='record-badge'
      aria-busy={isLoading}
      className={cn(
        recordBadgeVariants({ variant, size }),
        isEmpty &&
          'bg-transparent text-primary-500 ring-0 outline-1 outline-dotted outline-neutral-300 dark:bg-transparent dark:text-primary-500 dark:outline-primary-300',
        className
      )}>
      {showIcon && (
        <RecordIcon
          iconId={isEmpty ? 'plus' : resource?.icon || 'ticket'}
          color={isEmpty ? 'gray' : resource?.color || 'blue'}
          size={size === 'sm' ? 'xs' : 'xs'}
        />
      )}
      {isEmpty ? (
        <span data-slot='record-display' className='truncate'>
          {emptyLabel}
        </span>
      ) : isLoading ? (
        <Skeleton />
      ) : (
        <span data-slot='record-display' className='truncate'>
          {ticketNumber ? `#${ticketNumber}` : '#…'}
        </span>
      )}
    </div>
  )
}
