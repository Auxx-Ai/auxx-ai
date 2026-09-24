// packages/lib/src/accounting/ledger/setup/__tests__/accounting-enabled-triggers.test.ts
//
// plans/accounting/tasks/done/17-accounting-is-opt-in.md section 3 and 110 G2-G3: every
// document-driven posting trigger and evidence writer must import `isAccountingActive` and
// check it before it builds an entry. A source scan rather than a runtime call, so a new trigger copied from
// an old one (the way this codebase grows a fifth `build*Entry` builder) fails
// loudly here instead of quietly shipping without the gate.
//
// 🛑 This is a floor, not a ceiling: importing the helper is necessary but not
// sufficient (a file could import it and never call it). The per-trigger tests
// beside each file are what prove the call actually short-circuits the build,
// the period lock and the post.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every document-driven posting trigger (task 17 section 3's own list), as a
 * path relative to `packages/lib/src`.
 *
 * 🔑 Each entry names the file that BUILDS the entry, which is the only place
 * the gate can sit in front of. When a trigger's accounting moves into its own
 * module the path moves with it — the floor is "the builder is gated", not "this
 * particular filename still mentions the helper".
 *
 * ⚠️ D19 (53 §7.3.3) gives each transaction-driven family its own accounting
 * module, so this list grows one line per family as they land. That is the
 * intended direction: a seventh module with no gate must fail here.
 */
const TRIGGER_FILES = [
  // D19: `post-invoice.ts` is now the never-throws door and `issuance-accounting.ts`
  // is where the invoice is read, the entry built and the effect accepted — so
  // the gate moved with the build. It is still checked before ANY read.
  'accounting/sales/invoices/issuance-accounting.ts',
  'accounting/sales/orders/fulfill.ts',
  // Task 71: the invoice receipt, the channel receipt, the channel/hand refund,
  // the quote deposit and the vendor payment all build through one frame, and the
  // gate sits there once rather than in five copies.
  'accounting/money/post-movement.ts',
  // D19: `write-off.ts` still checks the gate before its own reads, and
  // `write-off-accounting.ts` is where the entry is now built and accepted — so
  // the gate is asserted on both halves rather than moved off the builder.
  'accounting/sales/invoices/write-off.ts',
  'accounting/sales/invoices/write-off-accounting.ts',
  'accounting/sales/credit-memos/writes.ts',
  'accounting/money/bank-deposits/writes.ts',
  'accounting/ledger/post/post-payout-entry.ts',
  // The per-org gate for the payout sync, which never even lets
  // `post/post-payout-entry.ts` see a payout for an org that has not enabled
  // accounting (task 17 section 3's payout-path decision).
  'accounting/money/payouts/sync.ts',
  'accounting/ledger/post/post-inventory-movement.ts',
  'accounting/sales/fulfillments/accounting.ts',
  'accounting/purchasing/post-vendor-bill.ts',
  'accounting/purchasing/vendor-credit/writes.ts',
  'accounting/purchasing/landed-cost/clear.ts',
  'accounting/money/invoice-payments/void-payment.ts',
  'accounting/money/vendor-payments/void-payment.ts',
  // 110 G2: the evidence writers.
  'accounting/money/customer-money/bridge.ts',
  'accounting/money/customer-money/record-evidence.ts',
  'accounting/money/customer-money/ingest.ts',
  'accounting/money/payouts/assess-payouts.ts',
] as const

const SRC_ROOT = join(__dirname, '..', '..', '..', '..')

describe('every posting trigger imports the accounting-active gate', () => {
  it.each(TRIGGER_FILES)('%s', (relativePath) => {
    const source = readFileSync(join(SRC_ROOT, relativePath), 'utf8')
    expect(source).toMatch(/isAccountingActive\(/)
    expect(source).toMatch(/from ['"].*accounting-enabled['"]/)
  })

  it('only the payout record import keeps the feature-only gate', () => {
    for (const relativePath of TRIGGER_FILES) {
      const source = readFileSync(join(SRC_ROOT, relativePath), 'utf8')
      const featureOnly = /isAccountingEnabled\(/.test(source)
      expect(featureOnly, relativePath).toBe(relativePath === 'accounting/money/payouts/sync.ts')
    }
  })
})
