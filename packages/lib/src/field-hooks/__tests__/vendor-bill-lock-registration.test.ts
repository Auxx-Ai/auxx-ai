// packages/lib/src/field-hooks/__tests__/vendor-bill-lock-registration.test.ts
//
// 🛑 A lock that never fires looks exactly like a lock nothing has tripped, so
// the registration is asserted on its own — the same reason
// `purchase-order-line-evidence-lock-registration.test.ts` exists. It also
// asserts the NEGATIVE half, which is the part a future edit is most likely to
// get wrong: the match's own fields and the payment writer's fields must stay
// open on a posted bill, or the exception queue and `syncVendorBillPaymentState`
// both stop working (73 D4).

import { describe, expect, it } from 'vitest'
import {
  guardPostedVendorBillFields,
  guardPostedVendorBillLineFields,
  VENDOR_BILL_LINE_LOCKED_ATTRS,
  VENDOR_BILL_LOCKED_ATTRS,
} from '../pre/vendor-bill-lock'
import { getFieldPreHooks, hasFieldPreHooks } from '../registry'

describe('vendor bill lock registration', () => {
  it('is reachable on the field pre-hook chain for every locked attribute', () => {
    for (const attribute of VENDOR_BILL_LOCKED_ATTRS) {
      expect(hasFieldPreHooks('vendor-bills', attribute)).toBe(true)
      expect(getFieldPreHooks('vendor-bills', attribute)).toContain(guardPostedVendorBillFields)
    }
    for (const attribute of VENDOR_BILL_LINE_LOCKED_ATTRS) {
      expect(hasFieldPreHooks('vendor-bill-lines', attribute)).toBe(true)
      expect(getFieldPreHooks('vendor-bill-lines', attribute)).toContain(
        guardPostedVendorBillLineFields
      )
    }
  })

  it('leaves the match verdict, the money axis and the lifecycle itself open', () => {
    for (const attribute of [
      // The verdict is a status calculation with no ledger effect, and it is the
      // exception queue.
      'vendor_bill_match_status',
      'vendor_bill_match_variance',
      'vendor_bill_match_notes',
      // `syncVendorBillPaymentState` is the only writer of these and a payment
      // against a posted bill is the ordinary case.
      'vendor_bill_amount_paid',
      'vendor_bill_paid_at',
      'vendor_bill_payment_status',
      'vendor_bill_amount_credited',
      'vendor_bill_balance',
      // Void writes this one.
      'vendor_bill_status',
    ] as const) {
      expect(hasFieldPreHooks('vendor-bills', attribute)).toBe(false)
    }
  })
})
