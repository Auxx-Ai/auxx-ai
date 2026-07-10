// apps/web/src/components/money/ui/line-builder/shared.ts

// Shared types + formatting helpers for the line builder cluster
// (line-builder.tsx, totals-footer.tsx).

import type { RecordId } from '~/components/resources'

/** Values for a new line — either a catalog pick or a free-typed one-off. */
export interface NewLineInput {
  name: string
  description?: string | null
  category?: string | null
  taxable?: boolean
  unitPrice?: number | null
  catalogItemRecordId?: RecordId
}

/** Format an amount in the org currency; em dash for unpriced values. */
export function formatCurrency(value: number | null | undefined, currencyCode: string): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
  }).format(value)
}

/** Capitalize a category value for chip display ('service' → 'Service'). */
export function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}
