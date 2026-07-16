// packages/ui/src/components/tucked-label.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import type * as React from 'react'

interface TuckedLabelProps {
  /** Leading icon (optional) — sized to 12px to match the label text. */
  icon?: React.ReactNode
  /** The label content (e.g. "Line items", or "Invoices · 3"). */
  children: React.ReactNode
  /** Right-aligned trailing slot — a count, badge, or small action button. */
  trailing?: React.ReactNode
  className?: string
}

/**
 * TuckedLabel — an Attio-style header "tab" that the following content tucks into.
 *
 * Rounded top corners, a tinted background, muted text, and a `-mb-3` (12px)
 * bottom margin so the sibling content card rendered immediately after it
 * overlaps the label's lower edge — the two then read as one stacked unit.
 *
 * It does NOT wrap the content. Render it as the sibling directly BEFORE the
 * block it heads (LineBuilder, invoices list, payments list), and give that
 * block a solid background so it paints over the tucked region. For the common
 * "header + tinted card" pairing, reach for {@link TuckedSection}, which owns
 * both halves and guarantees the tuck.
 */
export function TuckedLabel({ icon, children, trailing, className }: TuckedLabelProps) {
  return (
    <div
      className={cn(
        '-mb-3 flex items-center gap-1.5 rounded-t-xl px-3 pt-2 pb-5',
        'bg-primary-200/80 text-muted-foreground text-xs font-medium dark:bg-white/[0.03]',
        className
      )}>
      {icon && <span className='flex items-center [&_svg]:size-3'>{icon}</span>}
      <span className='min-w-0 truncate'>{children}</span>
      {trailing && <span className='ml-auto flex shrink-0 items-center'>{trailing}</span>}
    </div>
  )
}

interface TuckedSectionProps {
  /** Header label text. */
  label: React.ReactNode
  /** Leading icon in the header (optional). */
  icon?: React.ReactNode
  /** Right-aligned action rendered inside the tucked header — e.g. an `xs` button. */
  action?: React.ReactNode
  /** The section body — tucks into the header via the shared tinted card. */
  children: React.ReactNode
  /** Extra classes on the outer wrapper. */
  className?: string
  /**
   * Classes merged onto the content-card wrapper (`data-slot="tucked-content"`).
   * Because `cn` uses `twMerge`, this overrides the default tinted `rounded-xl`
   * card — pass `border-0 bg-transparent p-0` when the child brings its own frame
   * (e.g. `LineBuilder`, `EmptySection`), and reshape that child from here with
   * slot selectors, e.g. `[&_[data-slot=empty-section]]:rounded-xl`.
   */
  contentClassName?: string
}

/**
 * TuckedSection — a {@link TuckedLabel} header paired with the standard tinted
 * content card that tucks into it. Keeping both halves in one component means
 * the label and card stay direct siblings, so the label's `-mb-3` always
 * overlaps the card (wrapping the label in its own flex row breaks the tuck).
 *
 * Pass a small `action` (e.g. `<Button size='xs' variant='ghost'>`) to place a
 * control inside the header itself.
 */
export function TuckedSection({
  label,
  icon,
  action,
  children,
  className,
  contentClassName,
}: TuckedSectionProps) {
  return (
    <div className={className}>
      <TuckedLabel icon={icon} trailing={action}>
        {label}
      </TuckedLabel>
      <div
        data-slot='tucked-content'
        className={cn('rounded-xl border bg-primary-50', contentClassName)}>
        {children}
      </div>
    </div>
  )
}
