// apps/web/src/components/kopilot/ui/blocks/block-card.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode } from 'react'
import { Tooltip } from '~/components/global/tooltip'

const STATUS_CONFIG = {
  pending: { color: 'bg-amber-500', label: 'Pending Approval' },
  approved: { color: 'bg-emerald-500', label: 'Approved' },
  rejected: { color: 'bg-red-500', label: 'Rejected' },
} as const

export function StatusIndicator({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const { color, label } = STATUS_CONFIG[status]
  return (
    <Tooltip content={label}>
      <div className={cn('size-2 rounded-full', color)} />
    </Tooltip>
  )
}

export interface BlockCardAction {
  label: string
  onClick: () => void
  /** Blue text for primary action. Default: muted */
  primary?: boolean
}

interface BlockCardProps {
  /** Show header row. Default: true */
  hasHeader?: boolean
  /** Show footer row. Default: true */
  hasFooter?: boolean
  /** Indicator slot in header — StatusIndicator, icon, or any ReactNode */
  indicator?: ReactNode
  /** Left side of header */
  primaryText?: string
  /** Right side of header */
  secondaryText?: ReactNode
  /** Inner content area */
  children?: ReactNode
  /** Label shown left of action buttons */
  actionLabel?: string
  /** Action buttons in footer */
  actions?: BlockCardAction[]
}

export function BlockCard({
  hasHeader = true,
  hasFooter = true,
  indicator,
  primaryText,
  secondaryText,
  children,
  actionLabel,
  actions,
}: BlockCardProps) {
  const showFooter = hasFooter && (actionLabel || (actions && actions.length > 0))

  return (
    <div className='rounded-3xl bg-card/25 p-2 shadow-lg shadow-black/[.065] ring-1 ring-border-illustration'>
      {hasHeader && (
        <div className='flex items-start justify-between px-2 pt-1'>
          <div className='flex items-center gap-2'>
            {indicator}
            {primaryText && (
              <span className='text-xs font-semibold text-foreground/90'>{primaryText}</span>
            )}
          </div>
          {secondaryText && <div className='text-sm text-foreground/50'>{secondaryText}</div>}
        </div>
      )}

      {children && (
        <div
          className={cn(
            'rounded-2xl bg-illustration p-2 ring-1 ring-border-illustration',
            hasHeader ? 'mb-2 mt-2' : 'mt-0',
            showFooter ? 'mb-2' : 'mb-0'
          )}>
          {children}
        </div>
      )}

      {showFooter && (
        <div className='flex items-center justify-between gap-2 pl-3 pr-0.5'>
          {actionLabel ? (
            <span className='text-xs font-semibold text-foreground/80'>{actionLabel}</span>
          ) : (
            <span />
          )}
          <div className='flex'>
            {actions?.map((action) => (
              <button
                key={action.label}
                type='button'
                className={cn(
                  'flex h-7 cursor-pointer items-center justify-center rounded-full px-2 text-xs font-medium hover:bg-foreground/5',
                  action.primary ? 'text-blue-600 dark:text-blue-400' : 'text-foreground/65'
                )}
                onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
