// apps/web/src/components/money/billing/billing-summary-strip.tsx
'use client'

// Shared billing summary cells — ONE `@container`-responsive strip used by both the
// full-page Billing tab and the compact drawer Billing card. Cells reveal left-to-right as
// the container widens, and the grid column count grows to match, so cells stay evenly
// distributed at every width. A narrow container (the drawer at its ~400px min) keeps the
// action-relevant tail — Remaining + Balance due — and drops the funnel head; a wide
// container (the full page) shows the whole funnel in reading order. Purely container width,
// no viewport breakpoints.

import { cn } from '@auxx/ui/lib/utils'
import type { WorkOrderBillingView } from '~/components/money/billing/types'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'

export function BillingSummaryStrip({
  billing,
  className,
}: {
  billing: WorkOrderBillingView
  className?: string
}) {
  const firstLabel =
    billing.basis === 'fixed_contract'
      ? 'Contract value'
      : billing.basis === 'per_visit'
        ? 'Default visit price'
        : 'Rate per billing period'
  const showDeposit = billing.depositHeld > 0
  return (
    <div className={cn('@container', className)}>
      {/* Column count tracks the number of revealed cells at each container breakpoint so
          the grid never leaves a gap: 2 → 3 (@md) → 4 (@lg) → 5/6 (@xl, +deposit). */}
      <div
        className={cn(
          'grid grid-cols-2 gap-3 @md:grid-cols-3 @lg:grid-cols-4',
          showDeposit ? '@xl:grid-cols-6' : '@xl:grid-cols-5'
        )}>
        <Cell
          label={firstLabel}
          value={billing.billingAmount}
          currencyCode={billing.currencyCode}
          className='hidden @xl:flex'
        />
        <Cell
          label='Drafted'
          value={billing.drafted}
          currencyCode={billing.currencyCode}
          className='hidden @lg:flex'
        />
        <Cell
          label='Invoiced'
          value={billing.invoiced}
          currencyCode={billing.currencyCode}
          className='hidden @md:flex'
        />
        <Cell
          label='Remaining to invoice'
          value={billing.remaining}
          currencyCode={billing.currencyCode}
        />
        <Cell label='Balance due' value={billing.balanceDue} currencyCode={billing.currencyCode} />
        {showDeposit && (
          <Cell
            label='Deposit held'
            value={billing.depositHeld}
            currencyCode={billing.currencyCode}
            className='hidden @xl:flex'
          />
        )}
      </div>
    </div>
  )
}

function Cell({
  label,
  value,
  currencyCode,
  className,
}: {
  label: string
  value: number
  currencyCode: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span className='text-xs text-muted-foreground'>{label}</span>
      <span className='font-medium text-sm tabular-nums'>
        {formatCurrency(value, currencyCode)}
      </span>
    </div>
  )
}
