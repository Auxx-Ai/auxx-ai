// apps/web/src/components/accounting/ui/ledger/type-labels.ts
//
// Display copy for the two type vocabularies the outbox puts in its badge
// column: `GlPosting.postingType` and `MoneyTransaction.purpose`. The other two
// live beside this file - `export-avenue-labels.ts` for `ExportAvenue`, and
// `exportObjectTypeLabel` in `@auxx/lib/accounting/export/client` for the
// provider object shape.

import type { PostingType } from '@auxx/lib/accounting/ledger/client'
import type { WorkItemSourceKind } from '@auxx/lib/accounting/work-items/client'
import type { RouterOutputs } from '~/trpc/react'

/** Off the DTO rather than a second copy of the union - `money/client.ts` exports none. */
type MovementPurpose = NonNullable<RouterOutputs['ledger']['getMovement']>['purpose']

/**
 * Every `POSTING_TYPES` member, curated rather than de-snake_cased: the badge
 * column is scanned, and "Landed cost clear" is a column name, not a label.
 */
export const POSTING_TYPE_LABEL: Record<PostingType, string> = {
  fulfillment: 'Fulfillment',
  payout: 'Payout',
  month_end_deferral: 'Month-end deferral',
  month_end_reversal: 'Month-end close',
  inventory_movement: 'Inventory',
  vendor_bill: 'Vendor bill',
  manual_journal: 'Journal entry',
  opening_balance: 'Opening balance',
  bank_transaction: 'Bank line',
  bank_deposit: 'Bank deposit',
  write_off: 'Write-off',
  payment: 'Payment',
  refund: 'Refund',
  vendor_payment: 'Vendor payment',
  vendor_refund: 'Vendor refund',
  invoice_issued: 'Invoice',
  credit_memo: 'Credit memo',
  provider_sync: 'Accountant entry',
  recurring_journal: 'Recurring entry',
  vendor_credit: 'Vendor credit',
  landed_cost_clear: 'Landed cost',
}

/**
 * A posting type this deploy's catalogue does not name falls back to the raw
 * value, never a throw - the same rule `exportAvenueLabel` states at length.
 */
export function postingTypeLabel(postingType: string): string {
  return POSTING_TYPE_LABEL[postingType as PostingType] ?? postingType
}

export const MOVEMENT_PURPOSE_LABEL: Record<MovementPurpose, string> = {
  customer_receipt: 'Customer payment',
  customer_refund: 'Customer refund',
  vendor_payment: 'Vendor payment',
  vendor_refund: 'Vendor refund',
}

/** The Blocked tab's category column: what a work item names (91 §4.6). */
export const WORK_SOURCE_LABEL: Record<WorkItemSourceKind, string> = {
  money_transaction: 'Payment',
  fulfillment: 'Shipment',
  credit_memo: 'Credit memo',
  payout: 'Payout',
  financial_source_acceptance: 'Channel payment',
  provider_ledger_entry: 'Connected books',
}
