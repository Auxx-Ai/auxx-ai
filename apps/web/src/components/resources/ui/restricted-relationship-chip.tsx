// apps/web/src/components/resources/ui/restricted-relationship-chip.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Lock } from 'lucide-react'

/**
 * Non-interactive chip standing in for relationship targets the member can't
 * view (capability layer v2 Phase 5 §2/§3). Their recordIds are stripped
 * server-side; only the count survives. Deliberately distinct from
 * `RecordBadge`'s "Unknown" (genuinely not-found/deleted) — this is `no access`,
 * not `missing` — and carries no link or hover card (there is nothing the member
 * is allowed to see).
 *
 * @param count - Number of referenced records the member can't view.
 */
export function RestrictedRelationshipChip({
  count,
  className,
}: {
  count: number
  className?: string
}) {
  return (
    <span
      data-slot='restricted-relationship-chip'
      aria-label={`${count} restricted`}
      className={cn(
        'flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-sm',
        'cursor-default select-none ring-1 ring-neutral-300 bg-neutral-100 text-neutral-500',
        'dark:bg-muted dark:text-neutral-400 dark:ring-neutral-800',
        className
      )}>
      <Lock className='size-3 flex-shrink-0' />
      <span className='truncate'>{count} restricted</span>
    </span>
  )
}
