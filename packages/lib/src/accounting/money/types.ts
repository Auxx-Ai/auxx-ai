// packages/lib/src/accounting/money/types.ts

import type { MoneyMutationInput } from '../sales/types'

/** Input for `syncInvoicePaymentState` — the ledger → invoice mirror projection (§E.4). */
export interface SyncInvoicePaymentStateInput extends MoneyMutationInput {
  /** EntityInstance id of the invoice (not the RecordId). */
  invoiceInstanceId: string
}
