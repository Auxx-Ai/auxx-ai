// apps/web/src/components/accounting/ui/movement-badge.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { ArrowDownLeft, ArrowUpRight, CreditCard, type LucideIcon, RotateCcw } from 'lucide-react'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { formatMinor } from './ledger/format'
import { MOVEMENT_PURPOSE_LABEL } from './ledger/type-labels'

type MovementPurpose = keyof typeof MOVEMENT_PURPOSE_LABEL

/** Money in, money out, and the two that hand it back - `match-panel.tsx`'s card mark for the lane. */
const PURPOSE_ICONS: Record<MovementPurpose, LucideIcon> = {
  customer_receipt: CreditCard,
  customer_refund: RotateCcw,
  vendor_payment: ArrowUpRight,
  vendor_refund: ArrowDownLeft,
}

interface MovementBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  movement: {
    id: string
    purpose: string
    amountMinor: bigint | string | number
    currency: string
    /** Carried for completeness; `formatCurrency` takes the scale off the ISO code. */
    currencyExponent: number
  }
  /** `full` reads purpose and amount (drawers); `compact` is the icon and amount (list rows, where the memo already names the purpose). */
  detail?: 'full' | 'compact'
  /** Opens the movement in the ledger stack; a plain span without it. */
  onOpen?: () => void
  className?: string
}

/**
 * A `MoneyTransaction` as an inline chip - the purpose and the amount, never
 * the cuid it used to render as.
 *
 * Chrome comes from `recordBadgeVariants` so it sits beside a `RecordBadge`
 * without reading as a different kind of thing. It is NOT a `RecordBadge` and
 * cannot be: `MoneyTransaction` is a plain Drizzle table, so there is no
 * `RecordId` and no record to hover. It fetches nothing - `ledger.postingSources`
 * hydrates the movement beside the link.
 */
export function MovementBadge({
  movement,
  size,
  variant,
  detail = 'full',
  onOpen,
  className,
}: MovementBadgeProps) {
  const Icon = PURPOSE_ICONS[movement.purpose as MovementPurpose] ?? CreditCard
  const purpose = MOVEMENT_PURPOSE_LABEL[movement.purpose as MovementPurpose] ?? movement.purpose
  const amount = formatMinor(Number(movement.amountMinor), movement.currency)
  const label = detail === 'compact' ? amount : `${purpose} · ${amount}`
  const iconClass = size === 'sm' ? 'size-3 shrink-0' : 'size-4 shrink-0'

  if (onOpen) {
    return (
      <button
        type='button'
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
        className={cn(recordBadgeVariants({ variant: variant ?? 'link', size }), className)}>
        <Icon className={iconClass} />
        <span className='truncate'>{label}</span>
      </button>
    )
  }

  return (
    <span className={cn(recordBadgeVariants({ variant, size }), className)}>
      <Icon className={iconClass} />
      <span className='truncate'>{label}</span>
    </span>
  )
}
