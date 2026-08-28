// packages/lib/src/field-hooks/__tests__/purchase-order-line-evidence-lock-registration.test.ts
//
// 🛑 The failure this exists to catch is the one `pre/quote-deposit-guard.ts` documents for
// `quote_status`: a guard registered on the SYSTEM-hook chain
// (`resources/hooks/*-hooks.ts`) is dead for every real client write, because the surfaces
// that edit these fields go through `fieldValue.set` -> `FieldValueService`, which never
// reads that registry. The evidence lock has to be on THIS chain, and nothing but a
// registration assertion can tell the difference — a lock that never fires looks exactly
// like a lock nothing has tripped.
//
// Separate from the behaviour tests in `pre/purchase-order-line-evidence-lock.test.ts`
// because `getFieldPreHooks` self-inits the whole hook bootstrap, which needs the real
// `@auxx/database` module graph rather than that file's narrow schema stub.

import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_LOCKED_LINE_ATTRS,
  guardEvidenceLockedLineFields,
} from '../pre/purchase-order-line-evidence-lock'
import { getFieldPreHooks, hasFieldPreHooks } from '../registry'

describe('purchase order line evidence lock registration', () => {
  it('is reachable on the field pre-hook chain for both locked attributes', () => {
    for (const attribute of EVIDENCE_LOCKED_LINE_ATTRS) {
      expect(hasFieldPreHooks('purchase-order-lines', attribute)).toBe(true)
      expect(getFieldPreHooks('purchase-order-lines', attribute)).toContain(
        guardEvidenceLockedLineFields
      )
    }
  })

  // The two agreed TERMS of the order, and only those. `description`, `weight`, `sortOrder`
  // and the `vendorPart` link stay editable on a booked line — amending an order is a real
  // workflow (§6.5), and over-locking pushes people into delete-and-recreate, which takes the
  // receipts with it.
  it('locks exactly the two agreed-terms fields and nothing else on the line', () => {
    expect([...EVIDENCE_LOCKED_LINE_ATTRS]).toEqual([
      'purchase_order_line_quantity_ordered',
      'purchase_order_line_expected_unit_price',
    ])
    for (const attribute of [
      'purchase_order_line_description',
      'purchase_order_line_weight',
      'purchase_order_line_vendor_part',
    ] as const) {
      expect(hasFieldPreHooks('purchase-order-lines', attribute)).toBe(false)
    }
  })
})
