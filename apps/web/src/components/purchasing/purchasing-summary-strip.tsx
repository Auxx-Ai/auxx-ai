// apps/web/src/components/purchasing/purchasing-summary-strip.tsx
'use client'

// The purchasing cards' summary strip — the same three-cell header the work-order
// drawer's Billing card puts above its rows (`billing-summary-strip.tsx`), with the
// currency formatting lifted out so a strip can carry quantities too.
//
// Deliberately NOT a reuse of `BillingSummaryStrip`: that one is typed against
// `WorkOrderBillingView` and formats every cell as currency, so a receiving strip
// (three quantities) cannot use it without either widening its prop to a union or
// pushing quantities through a currency formatter. The shared thing here was only
// ever the markup, so that is what is shared.

import { cn } from '@auxx/ui/lib/utils'

/** One labelled figure. `value` arrives pre-formatted — the strip never formats. */
export interface SummaryCell {
  label: string
  value: string
  /** Muted renders the figure in the label's colour — for a zero that is not news. */
  tone?: 'default' | 'muted'
}

/**
 * A row of labelled figures above a card's rows.
 *
 * Column count is fixed to the cell count rather than container-queried: these
 * cards carry three cells, which fits the drawer's ~400px min width without the
 * reveal-as-it-widens treatment the six-cell billing strip needs.
 */
export function PurchasingSummaryStrip({
  cells,
  className,
}: {
  cells: SummaryCell[]
  className?: string
}) {
  return (
    <div
      className={cn('grid gap-3', className)}
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((cell) => (
        <div key={cell.label} className='flex flex-col gap-0.5'>
          <span className='text-muted-foreground text-xs'>{cell.label}</span>
          <span
            className={cn(
              'font-medium text-sm tabular-nums',
              cell.tone === 'muted' && 'text-muted-foreground'
            )}>
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/** SINGLE_SELECT and RELATIONSHIP reads come back as arrays; everything else scalar. */
export function unwrapValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

/** Coerce a NUMBER system value to a number, treating absence as zero. */
export function numberValue(value: unknown): number {
  const raw = unwrapValue(value)
  const parsed = typeof raw === 'string' ? Number(raw) : raw
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

/** Trim a quantity's trailing zeros — `10` not `10.00`, `2.5` kept. */
export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}
