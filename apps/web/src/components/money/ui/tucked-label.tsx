// apps/web/src/components/money/ui/tucked-label.tsx
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
 * block a solid background so it paints over the tucked region.
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
