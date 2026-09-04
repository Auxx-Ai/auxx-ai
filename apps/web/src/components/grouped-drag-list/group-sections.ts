// apps/web/src/components/grouped-drag-list/group-sections.ts
//
// A group is encoded as EXPLICIT membership (a group's `itemIds`) with a
// DERIVED position: a group has no stored index, its header renders wherever its
// first member sits in the flat item order. Two sources of truth — order in the
// flat array, membership in the groups — and no third thing that can drift out
// of sync with either. This module is the walk that turns those two arrays into
// render sections.

/** One rendered run: a group and its members, or the implicit ungrouped run. */
export interface GroupedSection<TGroup> {
  /** Null for the implicit ungrouped run. */
  group: TGroup | null
  /** Item ids in this section, in `itemOrder` order. */
  itemIds: string[]
}

export interface GroupItemOrderParams<TGroup> {
  /** Flat display order. */
  itemOrder: string[]
  groups: TGroup[]
  /** The ids this group claims as members. */
  itemIdsOf: (group: TGroup) => string[]
  /**
   * Where an EMPTY group renders: immediately before this item. Read only while
   * the group has no surviving member, ignored once it has one. Omit the
   * accessor entirely for a group type that has no such concept.
   */
  anchorItemIdOf?: (group: TGroup) => string | undefined
  /** When true, groups with no surviving members are emitted with an empty `itemIds` (edit mode drop targets). Default false. */
  includeEmptyGroups?: boolean
}

/**
 * Build the render sections for one flat item order.
 *
 * Walks `itemOrder` once. An ungrouped item joins the run in progress; a grouped
 * item triggers its group's section *at that position*, containing every
 * surviving member of that group in `itemOrder` order, and those ids are then
 * skipped for the rest of the walk. So a group whose members are scattered
 * gathers at the position of its FIRST member — which is exactly what the
 * caller's own normalisation should make true in the stored array too (see
 * `components/fields/group-fields.ts` for the field panel's).
 *
 * Decisions this function pins down:
 * - **Consecutive ungrouped items coalesce** into one `group: null` section. No
 *   empty ungrouped section is ever emitted between two adjacent groups, and a
 *   run that resumes after a group starts a NEW section rather than reopening
 *   the previous one — sections are positional, not per-kind buckets.
 * - **An item listed by two groups belongs to the earlier group** in the
 *   `groups` array. That input is malformed; resolving to the first keeps the
 *   walk deterministic instead of duplicating the item into both sections.
 * - **Ghost members are silently skipped.** Ids in a group's members that are
 *   absent from `itemOrder` (deleted items) contribute nothing — the same
 *   skip-the-miss pattern the flat order itself already relies on.
 * - **Duplicates in `itemOrder` collapse** to their first occurrence.
 * - With `includeEmptyGroups`, groups with zero surviving members render
 *   immediately before their anchor item, or at the END when they have no
 *   anchor or their anchor no longer exists. An empty group has no member to
 *   derive a position from, so the anchor is the only thing it can be placed by;
 *   it is written by dragging the group. Read mode passes false and empty groups
 *   vanish entirely, anchor or not.
 * - **An anchor only fires where a section STARTS.** Later members of a group
 *   are consumed while emitting that group's block, so an anchor naming one is
 *   never reached and the empty group falls through to the end. Anchor resolvers
 *   only ever write an ungrouped item or a group's first member, so this costs
 *   nothing in practice and keeps a group's block unsplittable.
 *
 * Invariant: flattening the result's `itemIds` yields a permutation of
 * `itemOrder` (deduplicated) with no losses and no duplicates.
 *
 * Never mutates its inputs; the returned `group` values are the caller's own
 * objects, not copies.
 */
export function groupItemOrder<TGroup>(
  params: GroupItemOrderParams<TGroup>
): GroupedSection<TGroup>[] {
  const { itemOrder, groups, itemIdsOf, anchorItemIdOf } = params
  const includeEmptyGroups = params.includeEmptyGroups ?? false

  // Ownership is resolved once, first group wins, so an item listed twice can
  // never land in two sections.
  const ownerByItem = new Map<string, number>()
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index] as TGroup
    for (const itemId of itemIdsOf(group)) {
      if (!ownerByItem.has(itemId)) ownerByItem.set(itemId, index)
    }
  }

  const sections: GroupedSection<TGroup>[] = []
  const consumed = new Set<string>()
  const emitted = new Set<number>()
  // The ungrouped run currently open, or null when the last thing emitted was a
  // group (or nothing yet). This is what coalesces neighbours without ever
  // producing an empty `group: null` section.
  let openUngrouped: GroupedSection<TGroup> | null = null

  // Empty groups indexed by the item they render before, in `groups` order so
  // several anchored on the same item keep a stable sequence.
  const anchoredEmptyGroups = new Map<string, number[]>()
  if (includeEmptyGroups && anchorItemIdOf) {
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index] as TGroup
      const anchorItemId = anchorItemIdOf(group)
      if (anchorItemId === undefined) continue
      if (itemIdsOf(group).some((itemId) => itemOrder.includes(itemId))) continue
      const pending = anchoredEmptyGroups.get(anchorItemId)
      if (pending) pending.push(index)
      else anchoredEmptyGroups.set(anchorItemId, [index])
    }
  }

  for (const itemId of itemOrder) {
    if (consumed.has(itemId)) continue

    // Anchored empty groups go in BEFORE the section this item opens. Emitting
    // one closes the ungrouped run in progress, so the items after it start a
    // new section rather than reading as part of the run above the group.
    for (const index of anchoredEmptyGroups.get(itemId) ?? []) {
      sections.push({ group: groups[index] as TGroup, itemIds: [] })
      emitted.add(index)
      openUngrouped = null
    }

    consumed.add(itemId)

    const ownerIndex = ownerByItem.get(itemId)

    if (ownerIndex === undefined) {
      if (openUngrouped === null) {
        openUngrouped = { group: null, itemIds: [] }
        sections.push(openUngrouped)
      }
      openUngrouped.itemIds.push(itemId)
      continue
    }

    // First member seen decides the position; pull the rest of the group up to
    // it. Everything before this point in `itemOrder` is already consumed, so
    // re-scanning from the head only ever picks up later members, in order.
    const memberIds = [itemId]
    for (const candidateId of itemOrder) {
      if (consumed.has(candidateId)) continue
      if (ownerByItem.get(candidateId) !== ownerIndex) continue
      consumed.add(candidateId)
      memberIds.push(candidateId)
    }

    sections.push({ group: groups[ownerIndex] as TGroup, itemIds: memberIds })
    emitted.add(ownerIndex)
    openUngrouped = null
  }

  if (includeEmptyGroups) {
    for (let index = 0; index < groups.length; index++) {
      if (emitted.has(index)) continue
      sections.push({ group: groups[index] as TGroup, itemIds: [] })
    }
  }

  return sections
}
