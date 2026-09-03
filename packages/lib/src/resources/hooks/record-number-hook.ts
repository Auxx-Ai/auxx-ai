// packages/lib/src/resources/hooks/record-number-hook.ts

import { recordNumbering, type SequenceScope } from '../../records/record-numbering'
import type { SystemHookContext } from './types'

/**
 * The "theirs if they bring one, otherwise ours" rule for a document number
 * (plans/money/tasks/39-shopify-first-sync-followups.md section 6.5).
 *
 * On create, when the write already carries a non-blank string for the number
 * field (keyed by field id or by `systemAttribute`, the two shapes the write
 * path accepts), the value is kept as supplied and no `RecordSequence` number is
 * allocated. A data connector that brings the source's own number (Shopify's
 * `#1001`, a QuickBooks invoice number) lands here. With nothing supplied, the
 * number is allocated on `scope` and written under `field.id`, exactly as the
 * hooks did before. Updates are returned untouched: the number is stable for the
 * record's life.
 *
 * Only the hooks for `order_number`, `invoice_number` and
 * `purchase_order_number` use this; quotes, work orders, builds, tickets and
 * `vendor_bill_internal_number` stay hook-only.
 */
export async function keepOrAllocateRecordNumber(
  { operation, field, values, organizationId }: SystemHookContext,
  scope: SequenceScope
): Promise<Record<string, unknown>> {
  if (operation !== 'create') return values
  if (hasSuppliedNumber(values, field.id) || hasSuppliedNumber(values, field.systemAttribute)) {
    return values
  }
  const { recordNumber } = await recordNumbering.create(organizationId, scope)
  return { ...values, [field.id]: recordNumber }
}

function hasSuppliedNumber(values: Record<string, unknown>, key: string | null): boolean {
  if (!key) return false
  const value = values[key]
  return typeof value === 'string' && value.trim() !== ''
}
