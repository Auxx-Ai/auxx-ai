// packages/lib/src/resources/hooks/vendor-credit-hooks.ts

import { createLifecycleStatusGuard } from './lifecycle-status-guard'
import { keepOrAllocateRecordNumber } from './record-number-hook'
import type { SystemHook, SystemHookRegistry } from './types'

/**
 * Number the vendor credit on create: `VC-0001` off the `vendor_credit`
 * sequence scope, the mirror of `autoGenerateCreditMemoNumber`. The issue
 * entry keys its period key on this, so it has to exist before issue.
 */
const autoGenerateVendorCreditNumber: SystemHook = (context) =>
  keepOrAllocateRecordNumber(context, 'vendor_credit')

/** The `vendor_credit_status` values an ACTION owns. `draft` stays freely editable. */
export const VENDOR_CREDIT_ACTION_STATUSES = ['issued', 'settled', 'void'] as const

export const VENDOR_CREDIT_ACTION_STATUS_MESSAGE =
  'Use the vendor credit actions (Issue / Apply / Refund / Void) to set this status'

const rejectManualLifecycleStatus: SystemHook = createLifecycleStatusGuard({
  guardedValues: VENDOR_CREDIT_ACTION_STATUSES,
  message: VENDOR_CREDIT_ACTION_STATUS_MESSAGE,
})

export const VENDOR_CREDIT_HOOKS: SystemHookRegistry = {
  vendor_credit_number: [autoGenerateVendorCreditNumber],
  vendor_credit_status: [rejectManualLifecycleStatus],
}
