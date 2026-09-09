// packages/lib/src/resources/hooks/credit-memo-hooks.ts

import { createLifecycleStatusGuard } from './lifecycle-status-guard'
import { keepOrAllocateRecordNumber } from './record-number-hook'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Number the credit memo on create: `CM-0001` off the `credit_memo` sequence
 * scope. Mirrors `autoGenerateInvoiceNumber`, including the "theirs if they
 * bring one" rule, although the Shopify connector supplies no number
 * (plans/accounting/tasks/10 section 2.1), so in practice the hook always
 * allocates ours. `credit_memo_number` is `creatable: false`, so this hook is
 * its only writer; the issue entry keys its document number on it, which is why
 * it has to exist before issue.
 */
const autoGenerateCreditMemoNumber: SystemHook = (context) =>
  keepOrAllocateRecordNumber(context, 'credit_memo')

/**
 * The `credit_memo_status` values an ACTION owns. `draft` stays freely
 * editable (the connector creates drafts and a reviewer may return one); the
 * other three are written only by `issueCreditMemo`, `settleCreditMemo` and
 * `voidCreditMemo`, all of which write through `FieldValueService` and so never
 * meet this system pre-hook.
 */
export const CREDIT_MEMO_ACTION_STATUSES = ['issued', 'settled', 'void'] as const

export const CREDIT_MEMO_ACTION_STATUS_MESSAGE =
  'Use the credit memo actions (Issue / Apply / Refund / Void) to set this status'

const rejectManualLifecycleStatus: SystemHook = createLifecycleStatusGuard({
  guardedValues: CREDIT_MEMO_ACTION_STATUSES,
  message: CREDIT_MEMO_ACTION_STATUS_MESSAGE,
})

export const CREDIT_MEMO_HOOKS: SystemHookRegistry = {
  credit_memo_number: [autoGenerateCreditMemoNumber],
  credit_memo_status: [rejectManualLifecycleStatus],
}
