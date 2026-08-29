// apps/web/src/components/accounting/ui/ledger/stored-draft.ts

import type { MonthEndInventorySnapshot, PostingAssertions } from '@auxx/lib/postings/client'

/**
 * Read the assertions off a `PostingDetail.draft`, which crosses the wire as
 * `unknown`.
 *
 * 🛑 This is the ONLY place the roll-forward's numbers may come from. A posted
 * entry asserts what the world looked like when it was posted, and a REVERSAL
 * stores the pair already swapped (`reverse-entry.ts` calls `reverseAssertions`
 * before writing its own envelope). So the stored pair is rendered verbatim:
 * swapping again here, or re-deriving either side from the subledger, would make
 * a reversed month render as though it had never been reversed - which is the
 * exact failure task 09's contract exists to prevent.
 *
 * ⚠️ Narrowed by hand rather than through lib's `parsePostingDraft`, which is
 * not exported from `@auxx/lib/postings/client` and, more importantly, THROWS.
 * A throw is the right answer on the server, where a malformed envelope must
 * stop a close. In a drawer it would blank the whole panel - including the
 * journal entry, which is stored separately and is still perfectly readable - so
 * an unreadable envelope degrades to "no roll-forward" instead.
 */
export function readStoredAssertions(draft: unknown): PostingAssertions | null {
  if (!isRecord(draft)) return null
  const assertions = draft.assertions
  if (!isRecord(assertions) || assertions.kind !== 'month_end_inventory') return null

  const before = readSnapshot(assertions.before)
  const after = readSnapshot(assertions.after)
  if (!before || !after) return null

  return { kind: 'month_end_inventory', before, after }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every value is an integer count of MINOR units. A non-integer is not a balance. */
function readMinor(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function readSnapshot(value: unknown): MonthEndInventorySnapshot | null {
  if (!isRecord(value)) return null
  const balances = value.balances
  const activityTotals = value.activityTotals
  if (!isRecord(balances) || !isRecord(activityTotals)) return null

  const raw = readMinor(balances.inventory_raw_materials)
  const wip = readMinor(balances.inventory_wip)
  const finished = readMinor(balances.inventory_finished_goods)
  const labor = readMinor(activityTotals.absorbedLabor)
  const overhead = readMinor(activityTotals.absorbedOverhead)
  const adjustments = readMinor(activityTotals.inventoryAdjustments)

  if (
    raw === null ||
    wip === null ||
    finished === null ||
    labor === null ||
    overhead === null ||
    adjustments === null
  ) {
    return null
  }

  return {
    balances: {
      inventory_raw_materials: raw,
      inventory_wip: wip,
      inventory_finished_goods: finished,
    },
    activityTotals: {
      absorbedLabor: labor,
      absorbedOverhead: overhead,
      inventoryAdjustments: adjustments,
    },
  }
}
