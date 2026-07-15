// packages/ui/src/components/panel-card.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ChevronsUpDown } from 'lucide-react'
import type * as React from 'react'
import { SimpleTooltip } from './tooltip'

type WarningType = 'warning' | 'error'

const warningTone = (type: WarningType) =>
  type === 'error'
    ? {
        icon: 'bg-red-500/15 text-red-600 dark:text-red-400',
        title: 'text-red-600 dark:text-red-400',
      }
    : {
        icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        title: 'text-amber-600 dark:text-amber-500',
      }

/**
 * Circular warning/error icon that replaces a `PanelCardRow`'s leading icon when the row carries
 * `warnings`. The messages surface in a hover tooltip. Rendering inline (rather than a floating
 * corner badge) keeps the row height stable — a late-arriving async hint only swaps the icon and
 * re-tints the title, so it never reflows the panel.
 */
function PanelWarningIcon({ messages, type }: { messages: string[]; type: WarningType }) {
  return (
    <SimpleTooltip
      variant={type === 'error' ? 'destructive' : 'default'}
      contentComponent={
        <ul className='max-w-2xs space-y-0.5'>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      }>
      <span
        className={cn(
          'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3',
          warningTone(type).icon
        )}>
        <AlertTriangle />
      </span>
    </SimpleTooltip>
  )
}

interface PanelShellProps {
  /** Adds the popover-less chrome (`rounded-3xl shadow-xl ring-1 ring-border bg-popover`).
   * Omit when the shell renders inside a `PopoverContent` that already carries it. */
  standalone?: boolean
  className?: string
  children: React.ReactNode
}

/** Outer vertical stack for a sectioned panel body (`PanelCard`/`PanelSectionLabel` children). */
function PanelShell({ standalone, className, children }: PanelShellProps) {
  return (
    <div
      className={cn(
        'space-y-2 p-2',
        standalone && 'rounded-3xl bg-popover shadow-xl ring-1 ring-border',
        className
      )}>
      {children}
    </div>
  )
}

interface PanelCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds a top border + top padding to every row after the first, so rows never need to
   * track their own "am I first" flag. */
  divided?: boolean
}

/** A single rounded card grouping one or more `PanelCardRow`s. */
function PanelCard({ className, divided, children, ...props }: PanelCardProps) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-border/50 bg-muted/40 p-2',
        divided && 'space-y-3 [&>*+*]:border-t [&>*+*]:border-border/50 [&>*+*]:pt-3',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}

interface PanelCardRowProps {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
  onClick?: () => void
  /** When non-empty, the row's leading icon is replaced by a circular warning icon and the title
   * is re-tinted; the messages surface in a hover tooltip. Swaps in place — no layout shift. */
  warnings?: string[]
  warningType?: WarningType
}

/**
 * Icon + title/description + trailing-control row. Passing `onClick` makes the row itself
 * focusable/keyboard-activatable (`role='button'`) without turning it into a real `<button>` —
 * an interactive `trailing` control (e.g. `PanelRowValue`) stays independently clickable.
 */
function PanelCardRow({
  icon,
  title,
  description,
  trailing,
  className,
  onClick,
  warnings,
  warningType = 'warning',
}: PanelCardRowProps) {
  const interactive = Boolean(onClick)
  const hasWarning = Boolean(warnings && warnings.length > 0)

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={cn(
        'flex items-start gap-3',
        interactive &&
          'cursor-pointer rounded-lg focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring/50',
        className
      )}>
      {hasWarning ? (
        <PanelWarningIcon messages={warnings!} type={warningType} />
      ) : (
        icon && <span className='mt-0.5 shrink-0 text-foreground/50 [&_svg]:size-4.5'>{icon}</span>
      )}
      <div className='min-w-0 flex-1'>
        <div className={cn('text-sm font-medium', hasWarning && warningTone(warningType).title)}>
          {title}
        </div>
        {description && <div className='text-muted-foreground text-xs'>{description}</div>}
      </div>
      {trailing && <div className='ml-auto shrink-0'>{trailing}</div>}
    </div>
  )
}

interface PanelSectionLabelProps {
  children: React.ReactNode
  className?: string
}

/** Section heading sitting between cards, outside their border (Notion/Tailark idiom). */
function PanelSectionLabel({ children, className }: PanelSectionLabelProps) {
  return (
    <div className={cn('px-4 text-sm font-medium text-foreground/50', className)}>{children}</div>
  )
}

interface PanelRowValueProps extends React.ComponentPropsWithoutRef<'button'> {
  ref?: React.Ref<HTMLButtonElement>
  children: React.ReactNode
  /** Show the trailing `ChevronsUpDown` affordance. Defaults to `true`. */
  chevrons?: boolean
}

/**
 * The trailing "select-like" pill (value + chevrons). Forwards its ref and spreads props so it
 * can be used directly as a Radix `PopoverTrigger`/`PopoverAnchor` `asChild` target.
 */
function PanelRowValue({
  ref,
  children,
  className,
  chevrons = true,
  ...props
}: PanelRowValueProps) {
  return (
    <button
      ref={ref}
      type='button'
      className={cn(
        'flex items-center gap-1 rounded-xl bg-foreground/5 px-2 py-1 text-sm hover:bg-foreground/10 disabled:opacity-50',
        className
      )}
      {...props}>
      {children}
      {chevrons && <ChevronsUpDown className='size-3.5 text-muted-foreground' />}
    </button>
  )
}

export { PanelShell, PanelCard, PanelCardRow, PanelSectionLabel, PanelRowValue }
