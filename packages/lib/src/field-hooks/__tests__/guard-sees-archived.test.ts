// packages/lib/src/field-hooks/__tests__/guard-sees-archived.test.ts
//
// A pre-delete guard must not decide "does anything still depend on this
// record?" through `UnifiedCrudHandler.listFiltered`.
//
// **`listFiltered` cannot see an archived row.** Its paged query hardcodes
// `isNull(archivedAt)` into the `baseWhere` it shares with its `COUNT(*)`
// (`resources/crud/unified-handler-queries.ts:692`), and there is no option to
// turn that off. Every guard used it, which broke them in both directions:
//
//   - **Refusals under-refused.** Driven against dev on 2026-08-31,
//     `guardPurchaseOrderDelete` deleted `PO-0002` while an ARCHIVED vendor bill
//     still named it. `sweepEntityFieldValues` then removed both halves of the
//     relation, so the bill kept an empty Purchase Order cell and no trace an
//     order had ever existed, recoverable by nothing. It was caught only
//     because the §8 audit's orphan count moved 1 to 2; a query run afterwards
//     cannot see it, because the evidence is exactly what got swept.
//   - **Cascades under-cascaded**, stranding the archived children they exist
//     to collect.
//
// Cascades and static "refuse while a related row exists" checks have since
// left the hooks entirely: they are `onDelete` declarations on the registry's
// has_many fields, and the delete engine's closure collection is where the
// archived-rows question now lives for them. What a hook still reads is the
// child set a CONDITIONAL refusal is judged on (a movement's accounting date,
// a purchase order's lines on the way to its receipts), and those reads go
// through `pre/related-rows.ts` (`findRelatedInstanceIds`) or
// `pre/guarded-movements.ts` (`readMovementsByRelation`), which read
// `EntityInstance ⋈ FieldValue` directly and deliberately apply no `archivedAt`
// predicate. An archived movement is still in the ledger and still under
// whatever entry was filed for its month.
//
// This test is source-level on purpose. The behaviour it protects is the
// ABSENCE of a predicate, which no unit test with a mocked handler can observe:
// every guard test doubles the child lookup, so a guard could silently go back
// to `listFiltered` with all of them still green. That is precisely how the
// original defect shipped.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRE_DIR = join(__dirname, '..', 'pre')

/** Guards that read children for a conditional refusal, through the archive-aware readers. */
const FIXED = ['build-delete-guard.ts', 'part-delete-guard.ts', 'purchase-order-delete-guard.ts']

/**
 * **The quote guard carries the SAME defect and is not fixed here.** It
 * refuses while a converted job is still active, read through `listFiltered`,
 * so a job somebody archived makes the quote deletable. It is listed rather
 * than silently excluded, because that is what the old `KNOWN_UNGUARDED` list
 * did in `delete-guard-registration.test.ts` and it is the reason `builds`,
 * `purchase-orders` and `vendor-bills` were found rather than forgotten.
 *
 * When it is fixed, move it up to `FIXED` in the same commit.
 */
const KNOWN_UNFIXED = ['quote-delete-guard.ts']

/**
 * Guards that read NO entity children at all, so neither path is available to
 * get wrong.
 *
 * Each decides from the values `captureEventData` already put on the event, a
 * Drizzle table, or the general ledger: `invoice` reads `PaymentTransaction`
 * and the invoice's postings; `journal-entry` reads its own status and
 * `glPostingId`; `order` reads the fulfillment entries that name it; `vendor-bill`
 * reads its own status and accounting date; `work-order` reads
 * `InvoiceLineAllocation`. The child rows every one of them used to cascade or
 * refuse on are registry declarations now. The assertion below is what keeps
 * this from becoming a loophole: a guard listed here must call NEITHER reader
 * and never `listFiltered`, so the moment one starts reading children it fails
 * and has to be moved into `FIXED`.
 */
const NO_CHILD_READS = [
  // `credit-memo` reads its own status and issue date off the event and the
  // `PaymentTransaction` table for a refund that names the memo.
  'credit-memo-delete-guard.ts',
  'invoice-delete-guard.ts',
  'journal-entry-delete-guard.ts',
  'order-delete-guard.ts',
  'vendor-bill-delete-guard.ts',
  'work-order-delete-guard.ts',
]

const ARCHIVE_AWARE_READERS = /findRelatedInstanceIds|readMovementsByRelation/

function source(file: string): string {
  return readFileSync(join(PRE_DIR, file), 'utf8')
}

describe('delete guards read children through a path that sees archived rows', () => {
  it('accounts for every delete guard on disk: no guard escapes the three lists', () => {
    const onDisk = readdirSync(PRE_DIR)
      .filter((f) => f.endsWith('-delete-guard.ts') && !f.endsWith('.test.ts'))
      .sort()
    expect(onDisk).toEqual([...FIXED, ...KNOWN_UNFIXED, ...NO_CHILD_READS].sort())
  })

  it.each(FIXED)('%s reads children through an archive-aware reader, not listFiltered', (file) => {
    const src = source(file)
    // A comment naming it is fine; a call is not.
    expect(src).not.toMatch(/handler\.listFiltered\(/)
    expect(src).toMatch(ARCHIVE_AWARE_READERS)
  })

  it.each(KNOWN_UNFIXED)('%s is still on the old path: pinned, not forgotten', (file) => {
    expect(source(file)).toMatch(/handler\.listFiltered\(/)
  })

  it.each(NO_CHILD_READS)('%s reads no children through either path', (file) => {
    const src = source(file)
    expect(src).not.toMatch(/handler\.listFiltered\(/)
    expect(src).not.toMatch(ARCHIVE_AWARE_READERS)
  })

  it('no guard cascades a child by hand any more', () => {
    for (const file of [...FIXED, ...KNOWN_UNFIXED, ...NO_CHILD_READS]) {
      const src = source(file)
      expect(src, file).not.toMatch(/handler\.delete\(/)
      expect(src, file).not.toContain('suppressPostDeleteHooks: true')
    }
  })

  it('the shared reader applies no archivedAt predicate', () => {
    const related = readFileSync(join(PRE_DIR, 'related-rows.ts'), 'utf8')
    // The predicate this module exists to omit, in the form Drizzle writes it.
    expect(related).not.toMatch(/isNull\(\s*schema\.EntityInstance\.archivedAt\s*\)/)
  })

  it('the movement reader applies no archivedAt predicate either', () => {
    const movements = readFileSync(join(PRE_DIR, 'guarded-movements.ts'), 'utf8')
    expect(movements).not.toMatch(/isNull\(schema\.EntityInstance\.archivedAt\)/)
  })
})
