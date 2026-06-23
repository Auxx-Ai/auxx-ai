// packages/ui/src/components/metric-grid.tsx

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type * as React from 'react'

/** Props for a single MetricCell. */
interface MetricCellProps {
  /** Muted label above the value. Omit for a label-less cell (e.g. stacked badges). */
  label?: React.ReactNode
  /** Icon shown left of the value. */
  icon?: React.ReactNode
  /** Primary value. Ignored when `children` is provided. */
  value?: React.ReactNode
  /** Small muted subtitle under the value. */
  description?: React.ReactNode
  /** Skeleton in place of the value while loading. */
  loading?: boolean
  /** Custom body — overrides icon/value/description (badge stacks, ActorBadge, dates). */
  children?: React.ReactNode
  className?: string
}

/**
 * A single metric cell: a muted label over an icon + value (+ optional subtitle).
 * Pass `children` for a custom body (badge stacks, actor badges, two-line dates).
 * Always render inside a {@link MetricGrid}, which draws the dividers.
 */
export function MetricCell({
  label,
  icon,
  value,
  description,
  loading = false,
  children,
  className,
}: MetricCellProps) {
  return (
    <div className={cn('bg-background', className)}>
      {label && (
        <div className='px-3 pt-3 pb-1.5 text-sm font-medium text-muted-foreground'>{label}</div>
      )}
      <div className={cn('px-3 pb-3', !label && 'pt-3')}>
        {children ?? (
          <div className='flex items-center gap-2'>
            {icon}
            {loading ? (
              <Skeleton className='h-5 w-20' />
            ) : (
              <div className='min-w-0'>
                <div className='truncate text-sm font-semibold'>{value}</div>
                {description && (
                  <div className='truncate text-xs text-muted-foreground'>{description}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const COLUMN_CLASS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

/** Props for the MetricGrid container. */
interface MetricGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of columns (default 2). */
  columns?: 2 | 3 | 4
  /** MetricCell children. */
  children: React.ReactNode
}

/**
 * The detail-drawer metrics strip: a bordered grid of {@link MetricCell}s. Dividers are
 * drawn with a 1px gap over a `bg-border` backdrop, so they're column-count-agnostic.
 * Expects cells to fill complete rows; a partial last row leaves a divider-colored gap.
 * Defaults to a bottom edge (`border-b`); override via `className`.
 */
export function MetricGrid({ columns = 2, className, children, ...props }: MetricGridProps) {
  return (
    <div
      className={cn('grid gap-px border-b bg-border', COLUMN_CLASS[columns], className)}
      {...props}>
      {children}
    </div>
  )
}
