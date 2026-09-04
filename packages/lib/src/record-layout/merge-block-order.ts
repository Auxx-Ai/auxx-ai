// packages/lib/src/record-layout/merge-block-order.ts

/**
 * The block-order analogue of `apps/web/src/components/fields/merge-field-order.ts`.
 *
 * A stored `blockOrder` is a photograph of the registry at save time, so every
 * read path has to reconcile it against the live registry order
 * (`plans/drawer/record-layout-system.md` §6). The naive rule ("walk the stored
 * array, then append whatever is left") un-defaults the default: once an org has
 * saved a layout, a block shipped later always lands dead last, on whatever tab
 * happens to be at the end of the strip. This module is the replacement rule,
 * and it is deliberately the SAME algorithm the field panel already uses rather
 * than a second one.
 */

export interface MergeBlockOrderParams {
  /** Block ids in live registry order (tab by tab, each tab's run contiguous). */
  baseline: string[]
  /**
   * The persisted order. Sparse: a block missing from it takes its
   * registry-anchored position. May also contain ids that no longer exist.
   */
  storedOrder: string[]
  /**
   * True when a block belongs to a run that must stay contiguous, i.e. a block
   * whose tab membership was explicitly changed by the stored delta.
   *
   * Such a block sits inside another tab's run, so anchoring a brand-new
   * registry block on it would splice the new block into the wrong tab. The
   * guard is the exact twin of `mergeFieldOrder`'s `isGrouped`, which exists so
   * a new field never lands inside a field group's visual block.
   *
   * Optional; defaults to never.
   */
  isGrouped?: (id: string) => boolean
}

/**
 * Merge a stored block order against the live registry order.
 *
 * Stored entries keep their stored relative order: reordering a shipped default
 * deliberately does NOT reach an org that already customised its layout. Any
 * registry block absent from `storedOrder` is spliced in at its anchor rather
 * than appended.
 *
 * **Anchor rule.** For a baseline block missing from `storedOrder`, walk the
 * *baseline* backwards from that block's position and take the first block that
 * is (a) present in `storedOrder` and (b) not `isGrouped`. The new block is
 * spliced immediately after that anchor. If no candidate qualifies it is
 * spliced at the head.
 *
 * Guarantees:
 * - **Ghosts are dropped.** Ids in `storedOrder` absent from `baseline` (a
 * retired card, a deleted custom field) do NOT appear in the result. Callers
 * record them in `unresolvedBlockIds` and leave the stored delta alone, so a
 * temporarily absent block returns to its placement rather than losing it.
 * - **Fixpoint.** `merge(b, merge(b, s)) === merge(b, s)`. The result contains
 * exactly the baseline ids, so a re-merge finds nothing missing and nothing to
 * drop. This matters because the result can be handed straight back to a
 * writer.
 * - **New blocks keep their baseline relative order** among themselves when
 * several land on the same anchor.
 * - Duplicates in either input are collapsed to their first occurrence.
 *
 * Note: only ids from `storedOrder` are anchor candidates, so a block spliced in
 * by this function never becomes an anchor for another.
 *
 * @returns the baseline ids, ordered.
 */
export function mergeBlockOrder(params: MergeBlockOrderParams): string[] {
  const { baseline, storedOrder } = params
  const isGrouped = params.isGrouped ?? (() => false)

  if (baseline.length === 0) return []

  // Collapse duplicates: the baseline drives the result's membership.
  const baselineIds: string[] = []
  const baselineSet = new Set<string>()
  for (const id of baseline) {
    if (baselineSet.has(id)) continue
    baselineSet.add(id)
    baselineIds.push(id)
  }

  const storedSet = new Set(storedOrder)

  // Stored entries that still exist, in stored order. `placed` doubles as the
  // "was in the stored order" test below, which is what keeps spliced-in blocks
  // from becoming anchors themselves.
  const merged: string[] = []
  const placed = new Set<string>()
  for (const id of storedOrder) {
    if (!baselineSet.has(id)) continue
    if (placed.has(id)) continue
    placed.add(id)
    merged.push(id)
  }

  // Walk the baseline backwards so that several new blocks sharing one anchor
  // come out in baseline order (each is inserted directly after the anchor, so
  // the later one must be inserted first).
  for (let i = baselineIds.length - 1; i >= 0; i--) {
    const blockId = baselineIds[i] as string
    if (placed.has(blockId)) continue

    let anchor: string | undefined
    for (let j = i - 1; j >= 0; j--) {
      const candidate = baselineIds[j] as string
      if (!storedSet.has(candidate)) continue
      if (isGrouped(candidate)) continue
      anchor = candidate
      break
    }

    if (anchor === undefined) {
      merged.unshift(blockId)
    } else {
      merged.splice(merged.indexOf(anchor) + 1, 0, blockId)
    }
  }

  return merged
}
