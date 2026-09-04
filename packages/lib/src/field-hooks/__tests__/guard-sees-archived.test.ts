// packages/lib/src/field-hooks/__tests__/guard-sees-archived.test.ts
//
// A pre-delete guard must not decide "does anything still depend on this
// record?" through `UnifiedCrudHandler.listFiltered`.
//
// 🛑 **`listFiltered` cannot see an archived row.** Its paged query hardcodes
// `isNull(archivedAt)` into the `baseWhere` it shares with its `COUNT(*)`
// (`resources/crud/unified-handler-queries.ts:692`), and there is no option to
// turn that off. Every guard used it, which broke them in both directions:
//
//   - **Refusals under-refused.** Driven against dev on 2026-08-31,
//     `guardPurchaseOrderDelete` deleted `PO-0002` while an ARCHIVED vendor bill
//     still named it. `sweepEntityFieldValues` then removed both halves of the
//     relation, so the bill kept an empty Purchase Order cell and no trace an
//     order had ever existed — recoverable by nothing. It was caught only
//     because the §8 audit's orphan count moved 1 → 2; a query run afterwards
//     cannot see it, because the evidence is exactly what got swept.
//   - **Cascades under-cascaded**, stranding the archived children they exist
//     to collect.
//
// The replacement is `pre/related-rows.ts` (`findRelatedInstanceIds`), which
// reads `EntityInstance ⋈ FieldValue` directly and deliberately applies no
// `archivedAt` predicate. `pre/guarded-movements.ts` had the same bug and the
// same fix — an archived movement is still in the ledger and still under
// whatever entry was filed for its month.
//
// This test is source-level on purpose. The behaviour it protects is the
// ABSENCE of a predicate, which no unit test with a mocked handler can observe:
// every guard test doubles the child lookup, so a guard could silently go back
// to `listFiltered` with all 262 of them still green. That is precisely how the
// original defect shipped.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRE_DIR = join(__dirname, '..', 'pre')

/** The money delete guards — fixed and driven in a browser on 2026-08-31. */
const FIXED = [
  'build-delete-guard.ts',
  'part-delete-guard.ts',
  'purchase-order-delete-guard.ts',
  // Born on `findRelatedInstanceIds` (task 30 §9.1); never had the defect.
  'tariff-code-delete-guard.ts',
  'vendor-bill-delete-guard.ts',
]

/**
 * 🛑 **The dispatch guards carry the SAME defect and are not fixed here.**
 * Five `listFiltered` call sites: `invoice`/`order`/`work-order` cascade their
 * own lines (an archived line is stranded), and `quote`/`work-order` refuse on
 * a child that an archive makes invisible. They are listed rather than silently
 * excluded, because that is what the old `KNOWN_UNGUARDED` list did in
 * `delete-guard-registration.test.ts` and it is the reason `builds`,
 * `purchase-orders` and `vendor-bills` were found rather than forgotten.
 *
 * When one is fixed, move it up to `FIXED` in the same commit.
 */
const KNOWN_UNFIXED = [
  'invoice-delete-guard.ts',
  'order-delete-guard.ts',
  'quote-delete-guard.ts',
  'work-order-delete-guard.ts',
]

/**
 * Guards that read NO children at all, so neither path is available to get
 * wrong.
 *
 * `journal-entry-delete-guard.ts` decides entirely from the values
 * `captureEventData` already put on the event - the entry's own status and its
 * own `glPostingId` - and cascades nothing, because a journal entry owns no
 * child records (its lines are a JSON column on the row itself). The assertion
 * below is what keeps this from becoming a loophole: a guard listed here must
 * call NEITHER reader, so the moment one starts reading children it fails and
 * has to be moved into `FIXED`.
 */
const NO_CHILD_READS = ['journal-entry-delete-guard.ts']

function source(file: string): string {
  return readFileSync(join(PRE_DIR, file), 'utf8')
}

describe('delete guards read children through a path that sees archived rows', () => {
  it('accounts for every delete guard on disk — no guard escapes both lists', () => {
    const onDisk = readdirSync(PRE_DIR)
      .filter((f) => f.endsWith('-delete-guard.ts') && !f.endsWith('.test.ts'))
      .sort()
    expect(onDisk).toEqual([...FIXED, ...KNOWN_UNFIXED, ...NO_CHILD_READS].sort())
  })

  it.each(FIXED)('%s reads children through findRelatedInstanceIds, not listFiltered', (file) => {
    const src = source(file)
    // A comment naming it is fine; a call is not.
    expect(src).not.toMatch(/handler\.listFiltered\(/)
    expect(src).toContain('findRelatedInstanceIds')
  })

  it.each(KNOWN_UNFIXED)('%s is still on the old path — pinned, not forgotten', (file) => {
    expect(source(file)).toMatch(/handler\.listFiltered\(/)
  })

  it.each(NO_CHILD_READS)('%s reads no children through either path', (file) => {
    const src = source(file)
    expect(src).not.toMatch(/handler\.listFiltered\(/)
    expect(src).not.toContain('findRelatedInstanceIds')
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
