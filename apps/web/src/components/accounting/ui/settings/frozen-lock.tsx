// apps/web/src/components/accounting/ui/settings/frozen-lock.tsx
'use client'

// The setup freeze, as an icon rather than a paragraph.
//
// Every frozen field previously carried the whole reason as body text under the
// value. On the cutover snapshot that meant the same three sentences repeated
// once per account, which read as an alarm rather than as a state — the panel's
// own `showLabels` rule ("captions render only on the first pair, so the panel
// is not repetitive") applies just as well to the explanation.
//
// 🛑 The reason still has to be REACHABLE, not merely implied. A locked field
// with no explanation sends someone hunting for a disabled toggle that does not
// exist, so the icon is a tooltip trigger and never a bare glyph.

import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { LockIcon } from 'lucide-react'

interface FrozenLockProps {
  /** Why this field is locked. Rendered in the tooltip and as the accessible name. */
  reason: string
  className?: string
}

/**
 * A lock icon whose tooltip explains the freeze.
 *
 * The trigger is a focusable `span` rather than the bare icon so the reason is
 * reachable by keyboard and named for a screen reader — an `<svg>` with an
 * `aria-label` and no role is announced inconsistently.
 */
export function FrozenLock({ reason, className }: FrozenLockProps) {
  return (
    <SimpleTooltip content={reason} side='left'>
      <span
        role='img'
        aria-label={reason}
        tabIndex={0}
        className={cn(
          'inline-flex shrink-0 cursor-help items-center justify-self-end text-muted-foreground',
          'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className
        )}>
        <LockIcon className='h-3.5 w-3.5' />
      </span>
    </SimpleTooltip>
  )
}
