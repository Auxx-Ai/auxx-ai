// apps/web/src/components/threads/ui/thread-badge.tsx

'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { Mail } from 'lucide-react'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { useThread } from '../hooks/use-thread'

interface ThreadBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** Thread ID — optional, shows loading when undefined */
  threadId?: string | null
  /** Whether to show the leading icon (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Badge for a thread — displays a Mail icon and the thread subject.
 * Mirrors RecordBadge's variants/sizes by reusing `recordBadgeVariants`.
 */
export function ThreadBadge({
  threadId,
  showIcon = true,
  className,
  variant,
  size,
  ...props
}: ThreadBadgeProps) {
  const { thread, isLoading, isNotFound } = useThread({ threadId, enabled: !!threadId })

  const displayName = isNotFound ? 'Unknown thread' : thread?.subject?.trim() || '(no subject)'
  const showLoading = !threadId || (isLoading && !thread)

  return (
    <div
      data-slot='thread-badge'
      aria-busy={showLoading}
      className={cn(recordBadgeVariants({ variant, size }), className)}
      {...props}>
      {showLoading ? (
        <>
          {showIcon && <Skeleton />}
          <Skeleton />
        </>
      ) : (
        <>
          {showIcon && <Mail className={size === 'sm' ? 'size-3' : 'size-3.5'} />}
          <span data-slot='record-display' className='truncate'>
            {displayName}
          </span>
        </>
      )}
    </div>
  )
}
