// apps/web/src/components/fields/merge-field-order.ts
//
// A stored `FieldViewConfig.fieldOrder` is a FULL array, not a sparse delta, so
// every read path has to reconcile it against the live baseline. The old rule
// ("walk the stored array, then append whatever is left") un-defaults the
// default: once a view row exists, `CustomField.sortOrder` stops governing
// anything, and a field created later always lands dead last — below the
// Created/Updated metadata block. This module is the replacement rule.

export interface MergeFieldOrderParams {
  /** Field ids in live baseline order (already sorted: CustomField.sortOrder ASC, with trailing metadata partitioned last by the server). */
  baseline: string[]
  /** The persisted order from FieldViewConfig.fieldOrder. May contain ids no longer in baseline (deleted fields). */
  storedOrder: string[]
  /** True for trailing metadata fields (id / createdAt / updatedAt / created_by_id). Optional; defaults to never. */
  isTrailing?: (fieldId: string) => boolean
  /** True when the field belongs to some field group. Optional; defaults to never. Used so a new field is never dropped inside a group's visual block. */
  isGrouped?: (fieldId: string) => boolean
}

/**
 * Merge a stored field order against the live baseline.
 *
 * Stored entries keep their stored relative order — reordering an existing
 * field in settings deliberately does NOT reach a customised view. Any baseline
 * field absent from `storedOrder` is spliced in at its anchor rather than
 * appended.
 *
 * **Anchor rule.** For a baseline field missing from `storedOrder`, walk the
 * *baseline* backwards from that field's position and take the first field that
 * is (a) present in `storedOrder`, (b) not `isTrailing` — unless the field
 * being placed is itself trailing — and (c) not `isGrouped`. The new field is
 * spliced immediately after that anchor. If no candidate qualifies it is
 * spliced at the head. Because the server already partitions metadata last,
 * this places new business fields above the trailing block, while a new
 * *trailing* field joins the end of that block instead of jumping above it.
 *
 * Guarantees:
 * - **Ghosts are dropped.** Ids in `storedOrder` that are absent from
 *   `baseline` (deleted fields) do NOT appear in the result. Callers map ids to
 *   fields and skip misses anyway, but the merged order is itself persisted, so
 *   carrying dead ids forward would keep resurrecting them in every later merge.
 * - **Fixpoint.** `merge(baseline, merge(baseline, stored)) === merge(baseline, stored)`.
 *   The result contains exactly the baseline ids, so a re-merge finds nothing
 *   missing and nothing to drop. This matters because the result gets saved.
 * - **New fields keep their baseline relative order** among themselves when
 *   several land on the same anchor.
 * - Duplicates in either input are collapsed to their first occurrence.
 *
 * Note: only ids from `storedOrder` are anchor candidates — a field spliced in
 * by this function never becomes an anchor for another.
 *
 * @returns the baseline ids, ordered.
 */
export function mergeFieldOrder(params: MergeFieldOrderParams): string[] {
  const { baseline, storedOrder } = params
  const isTrailing = params.isTrailing ?? (() => false)
  const isGrouped = params.isGrouped ?? (() => false)

  if (baseline.length === 0) return []

  // Collapse duplicates — the baseline drives the result's membership.
  const baselineIds: string[] = []
  const baselineSet = new Set<string>()
  for (const id of baseline) {
    if (baselineSet.has(id)) continue
    baselineSet.add(id)
    baselineIds.push(id)
  }

  const storedSet = new Set(storedOrder)

  // Stored entries that still exist, in stored order. `placed` doubles as the
  // "was in the stored order" test below, which is what keeps spliced-in fields
  // from becoming anchors themselves.
  const merged: string[] = []
  const placed = new Set<string>()
  for (const id of storedOrder) {
    if (!baselineSet.has(id)) continue
    if (placed.has(id)) continue
    placed.add(id)
    merged.push(id)
  }

  // Walk the baseline backwards so that several new fields sharing one anchor
  // come out in baseline order (each is inserted directly after the anchor, so
  // the later one must be inserted first).
  for (let i = baselineIds.length - 1; i >= 0; i--) {
    const fieldId = baselineIds[i] as string
    if (placed.has(fieldId)) continue

    // The trailing guard exists to keep a business field above the metadata
    // block, so it only applies when the field being PLACED is a business
    // field. A newly-appearing trailing field (an old view predating
    // `created_by_id`, say) may anchor on the block and join its end. The group
    // guard has no such exemption — nothing lands inside a group's block.
    const placingTrailing = isTrailing(fieldId)

    let anchor: string | undefined
    for (let j = i - 1; j >= 0; j--) {
      const candidate = baselineIds[j] as string
      if (!storedSet.has(candidate)) continue
      if (isTrailing(candidate) && !placingTrailing) continue
      if (isGrouped(candidate)) continue
      anchor = candidate
      break
    }

    if (anchor === undefined) {
      merged.unshift(fieldId)
    } else {
      merged.splice(merged.indexOf(anchor) + 1, 0, fieldId)
    }
  }

  return merged
}
