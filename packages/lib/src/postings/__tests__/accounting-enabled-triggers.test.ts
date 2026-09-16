// packages/lib/src/postings/__tests__/accounting-enabled-triggers.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3, and the exact-set
// model of `types.test.ts`: every document-driven posting trigger the brief
// names must import `isAccountingEnabled` and check it before it builds an
// entry. A source scan rather than a runtime call, so a new trigger copied from
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
  'money/invoices/issuance-accounting.ts',
  'money/orders/fulfill.ts',
  'money/fulfillment-posting/run.ts',
  'money/payments/post-transaction.ts',
  // Two deposit-application lanes, and BOTH are gated. The dispatch-era one
  // posts off `PaymentAllocation`; the effects one posts off `MoneyApplication`
  // (D19). Neither may build an entry for an org that has accounting off.
  'money/payments/post-deposit-application.ts',
  'money/customer-money/deposit-application-accounting.ts',
  // D19: `write-off.ts` still checks the gate before its own reads, and
  // `write-off-accounting.ts` is where the entry is now built and accepted — so
  // the gate is asserted on both halves rather than moved off the builder.
  'money/invoices/write-off.ts',
  'money/invoices/write-off-accounting.ts',
  'money/credit-memos/writes.ts',
  'money/bank-deposits/writes.ts',
  'postings/post-payout-entry.ts',
  // The per-org gate for the payout sync, which never even lets
  // `post-payout-entry.ts` see a payout for an org that has not enabled
  // accounting (task 17 section 3's payout-path decision).
  'money/payouts/sync.ts',
] as const

const SRC_ROOT = join(__dirname, '..', '..')

describe('every posting trigger imports the accounting-enabled gate', () => {
  it.each(TRIGGER_FILES)('%s', (relativePath) => {
    const source = readFileSync(join(SRC_ROOT, relativePath), 'utf8')
    expect(source).toMatch(/isAccountingEnabled/)
    expect(source).toMatch(/from ['"].*accounting-enabled['"]/)
  })
})
