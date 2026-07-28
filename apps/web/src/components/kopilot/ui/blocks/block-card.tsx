// apps/web/src/components/kopilot/ui/blocks/block-card.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Maximize2, Minimize2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { ActionButton } from '~/components/workflow/ui/action-button'

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
  /** Red text for a destructive action — deny, reject. Default: muted */
  destructive?: boolean
}

/**
 * The text-pill action treatment shared by every approval surface — Kopilot's
 * in-chat blocks and the notification panel's approval rows. Deliberately not a
 * shadcn `Button`: at `h-7` it sits correctly against both the block footer and
 * the notification row's `h-9` header strip.
 */
export function BlockCardActionButton({
  label,
  onClick,
  primary,
  destructive,
  disabled,
}: BlockCardAction & { disabled?: boolean }) {
  return (
    <button
      type='button'
      disabled={disabled}
      className={cn(
        'flex h-7 cursor-pointer items-center justify-center rounded-full px-2 text-xs font-medium hover:bg-foreground/5',
        'disabled:pointer-events-none disabled:opacity-50',
        primary
          ? 'text-blue-600 dark:text-blue-400'
          : destructive
            ? 'text-red-600 dark:text-red-400'
            : 'text-foreground/65'
      )}
      onClick={onClick}>
      {label}
    </button>
  )
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
  /** Debug slot identifier */
  'data-slot'?: string
  /** Extra classes for the outer wrapper. Use `[&_[data-slot=block-card-body]]:p-0` etc. to target inner slots. */
  className?: string
  /** Render a Maximize/Minimize toggle in the header and collapse the body. */
  collapsible?: boolean
  /** Initial collapsed state when `collapsible`. Default: false. */
  defaultCollapsed?: boolean
  /**
   * Extra header-right slot — rendered between `secondaryText` and the
   * built-in collapse toggle. Lets callers add their own icon buttons
   * (e.g. table-block's expand-to-dialog) without forking the layout.
   * Use `ActionButton` for visual consistency.
   */
  headerActions?: ReactNode
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <Tooltip content={collapsed ? 'Expand' : 'Collapse'}>
      <div className='-my-1 -mr-1'>
        <ActionButton onClick={onToggle}>
          {collapsed ? <Maximize2 className='size-3.5' /> : <Minimize2 className='size-3.5' />}
        </ActionButton>
      </div>
    </Tooltip>
  )
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
  'data-slot': dataSlot,
  className,
  collapsible,
  defaultCollapsed = false,
  headerActions,
}: BlockCardProps) {
  const showFooter = hasFooter && (actionLabel || (actions && actions.length > 0))
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const body = (
    <>
      {children && (
        <div
          data-slot='block-card-body'
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
              <BlockCardActionButton key={action.label} {...action} />
            ))}
          </div>
        </div>
      )}
    </>
  )

  return (
    <div
      data-slot={dataSlot}
      className={cn(
        'rounded-3xl bg-card/25 p-2 shadow-lg shadow-black/[.065] ring-1 ring-border-illustration',
        className
      )}>
      {hasHeader && (
        <div className='flex items-start justify-between px-2 pt-1'>
          <div className='flex items-center gap-2'>
            {indicator}
            {primaryText && (
              <span className='text-xs font-semibold text-foreground/90'>{primaryText}</span>
            )}
          </div>
          <div className='flex items-center gap-1.5'>
            {secondaryText && <div className='text-sm text-foreground/50'>{secondaryText}</div>}
            {headerActions}
            {collapsible && (
              <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
            )}
          </div>
        </div>
      )}

      {collapsible ? (
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
              animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
              exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              style={{ overflow: 'hidden' }}>
              {body}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        body
      )}
    </div>
  )
}
