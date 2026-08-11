// apps/web/src/components/fields/group-fields.ts
//
// Field groups are encoded as EXPLICIT membership (`FieldGroup.fieldIds`) with a
// DERIVED position: a group has no stored index, its header renders wherever its
// first member sits in `fieldOrder`. Two sources of truth — order in
// `fieldOrder`, membership in `fieldGroups[].fieldIds` — and no third thing that
// can drift out of sync with either. This module is the walk that turns those
// two arrays into render sections, plus the two writes that keep them coherent.

/** Structural mirror of `FieldGroup` from `@auxx/lib/conditions/client`; kept local so this module stays dependency-free and unit-testable. */
export interface FieldGroupLike {
  id: string
  label: string
  collapsed?: boolean
  icon?: string
  fieldIds: string[]
  /**
   * Where an EMPTY group renders: immediately before this field. Read only
   * while the group has no surviving member, ignored once it has one. See
   * {@link resolveEmptyGroupAnchor}.
   */
  anchorFieldId?: string
}

export interface GroupedFieldSection {
  /** Null for the implicit ungrouped run. */
  group: FieldGroupLike | null
  /** Field ids in this section, in `fieldOrder` order. */
  fieldIds: string[]
}

export interface GroupFieldOrderParams {
  /** Flat display order (already merged against the baseline by `mergeFieldOrder`). */
  fieldOrder: string[]
  groups: FieldGroupLike[]
  /** When true, groups with no surviving members are emitted with an empty `fieldIds` (edit mode drop targets). Default false. */
  includeEmptyGroups?: boolean
}

/**
 * Build the render sections for one flat field order.
 *
 * Walks `fieldOrder` once. An ungrouped field joins the run in progress; a
 * grouped field triggers its group's section *at that position*, containing
 * every surviving member of that group in `fieldOrder` order, and those ids are
 * then skipped for the rest of the walk. So a group whose members are scattered
 * gathers at the position of its FIRST member — which is exactly what
 * {@link normalizeGroupContiguity} makes true in the stored array too.
 *
 * Decisions this function pins down:
 * - **Consecutive ungrouped fields coalesce** into one `group: null` section. No
 *   empty ungrouped section is ever emitted between two adjacent groups, and a
 *   run that resumes after a group starts a NEW section rather than reopening
 *   the previous one — sections are positional, not per-kind buckets.
 * - **A field listed by two groups belongs to the earlier group** in the
 *   `groups` array. That input is malformed; resolving to the first keeps the
 *   walk deterministic instead of duplicating the field into both sections.
 * - **Ghost members are silently skipped.** Ids in a group's `fieldIds` that are
 *   absent from `fieldOrder` (deleted fields) contribute nothing — the same
 *   skip-the-miss pattern `fieldOrder` itself already relies on.
 * - **Duplicates in `fieldOrder` collapse** to their first occurrence, matching
 *   `mergeFieldOrder`.
 * - With `includeEmptyGroups`, groups with zero surviving members render
 *   immediately before their `anchorFieldId`, or at the END when they have no
 *   anchor or their anchor no longer exists. An empty group has no member to
 *   derive a position from, so the anchor is the only thing it can be placed by;
 *   it is written by dragging the group (see {@link resolveEmptyGroupAnchor}).
 *   Read mode passes false and empty groups vanish entirely, anchor or not.
 * - **An anchor only fires where a section STARTS.** Later members of a group
 *   are consumed while emitting that group's block, so an anchor naming one is
 *   never reached and the empty group falls through to the end. The resolver
 *   only ever writes an ungrouped field or a group's first member, so this
 *   costs nothing in practice and keeps a group's block unsplittable.
 *
 * Invariant: flattening the result's `fieldIds` yields a permutation of
 * `fieldOrder` (deduplicated) with no losses and no duplicates.
 *
 * Never mutates its inputs; the returned `group` values are the caller's own
 * objects, not copies.
 */
export function groupFieldOrder(params: GroupFieldOrderParams): GroupedFieldSection[] {
  const { fieldOrder, groups } = params
  const includeEmptyGroups = params.includeEmptyGroups ?? false

  // Ownership is resolved once, first group wins, so a field listed twice can
  // never land in two sections.
  const ownerByField = new Map<string, number>()
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index] as FieldGroupLike
    for (const fieldId of group.fieldIds) {
      if (!ownerByField.has(fieldId)) ownerByField.set(fieldId, index)
    }
  }

  const sections: GroupedFieldSection[] = []
  const consumed = new Set<string>()
  const emitted = new Set<number>()
  // The ungrouped run currently open, or null when the last thing emitted was a
  // group (or nothing yet). This is what coalesces neighbours without ever
  // producing an empty `group: null` section.
  let openUngrouped: GroupedFieldSection | null = null

  // Empty groups indexed by the field they render before, in `groups` order so
  // several anchored on the same field keep a stable sequence.
  const anchoredEmptyGroups = new Map<string, number[]>()
  if (includeEmptyGroups) {
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index] as FieldGroupLike
      if (group.anchorFieldId === undefined) continue
      if (group.fieldIds.some((fieldId) => fieldOrder.includes(fieldId))) continue
      const pending = anchoredEmptyGroups.get(group.anchorFieldId)
      if (pending) pending.push(index)
      else anchoredEmptyGroups.set(group.anchorFieldId, [index])
    }
  }

  for (const fieldId of fieldOrder) {
    if (consumed.has(fieldId)) continue

    // Anchored empty groups go in BEFORE the section this field opens. Emitting
    // one closes the ungrouped run in progress, so the fields after it start a
    // new section rather than reading as part of the run above the group.
    for (const index of anchoredEmptyGroups.get(fieldId) ?? []) {
      sections.push({ group: groups[index] as FieldGroupLike, fieldIds: [] })
      emitted.add(index)
      openUngrouped = null
    }

    consumed.add(fieldId)

    const ownerIndex = ownerByField.get(fieldId)

    if (ownerIndex === undefined) {
      if (openUngrouped === null) {
        openUngrouped = { group: null, fieldIds: [] }
        sections.push(openUngrouped)
      }
      openUngrouped.fieldIds.push(fieldId)
      continue
    }

    // First member seen decides the position; pull the rest of the group up to
    // it. Everything before this point in `fieldOrder` is already consumed, so
    // re-scanning from the head only ever picks up later members, in order.
    const memberIds = [fieldId]
    for (const candidateId of fieldOrder) {
      if (consumed.has(candidateId)) continue
      if (ownerByField.get(candidateId) !== ownerIndex) continue
      consumed.add(candidateId)
      memberIds.push(candidateId)
    }

    sections.push({ group: groups[ownerIndex] as FieldGroupLike, fieldIds: memberIds })
    emitted.add(ownerIndex)
    openUngrouped = null
  }

  if (includeEmptyGroups) {
    for (let index = 0; index < groups.length; index++) {
      if (emitted.has(index)) continue
      sections.push({ group: groups[index] as FieldGroupLike, fieldIds: [] })
    }
  }

  return sections
}

/**
 * Rewrite `fieldOrder` so every group's members sit contiguously, anchored at
 * the position of that group's FIRST member.
 *
 * Relative order is preserved both within each group and among the ungrouped
 * fields; the only movement is members of a group being pulled up to their
 * group's anchor. This is what makes "a group's block is one contiguous visual
 * run" true of the *stored* array and not merely of the render walk — which is
 * what {@link reassignFieldToGroup} depends on, since drag-and-drop reassignment
 * infers intent from where a field was dropped.
 *
 * Idempotent: the result is already contiguous, so a second call is a no-op.
 * Defined as the flattening of {@link groupFieldOrder}, so the two can never
 * disagree about where a group's block starts; it inherits that function's
 * handling of ghosts (skipped), duplicate memberships (first group wins) and
 * duplicate ids (collapsed to the first occurrence). Empty groups contribute
 * nothing — they have no position to anchor.
 *
 * Never mutates its inputs.
 */
export function normalizeGroupContiguity(fieldOrder: string[], groups: FieldGroupLike[]): string[] {
  const normalized: string[] = []
  for (const section of groupFieldOrder({ fieldOrder, groups })) {
    for (const fieldId of section.fieldIds) normalized.push(fieldId)
  }
  return normalized
}

export interface ReassignFieldToGroupParams {
  groups: FieldGroupLike[]
  fieldId: string
  /** Target group id, or null to make the field ungrouped. */
  groupId: string | null
}

/**
 * Move a field's group membership — the drop handler's half of a drag.
 *
 * The field is removed from every group's `fieldIds` and, when `groupId` is
 * non-null, appended to that group's. Membership is the only thing this touches:
 * position lives in `fieldOrder` and is the caller's business (run
 * {@link normalizeGroupContiguity} afterwards to pull the field into its new
 * group's block).
 *
 * Decisions this function pins down:
 * - **Appended, never inserted.** A group's own order is its `fieldIds` order
 *   only for tie-breaking; what renders is `fieldOrder`, so the append position
 *   is not user-visible.
 * - **No duplicates.** Re-assigning a field to the group it is already in is a
 *   no-op: it keeps its existing slot instead of gaining a second entry or
 *   jumping to the end.
 * - **An unknown `groupId` ungroups the field** rather than throwing — a group
 *   deleted between render and drop must not wedge the panel.
 * - **First match wins** if two groups share an id (malformed input), keeping
 *   the single-owner invariant {@link groupFieldOrder} resolves by.
 *
 * Never mutates the input. Groups whose membership is unchanged are returned by
 * reference inside a new array, so an already-correct assignment costs nothing
 * downstream of `React.memo`.
 */
export function reassignFieldToGroup(params: ReassignFieldToGroupParams): FieldGroupLike[] {
  const { groups, fieldId, groupId } = params

  let targetClaimed = false

  return groups.map((group) => {
    const shouldContain = !targetClaimed && groupId !== null && group.id === groupId
    if (shouldContain) targetClaimed = true

    const contains = group.fieldIds.includes(fieldId)
    if (contains === shouldContain) return group

    const fieldIds = shouldContain
      ? [...group.fieldIds, fieldId]
      : group.fieldIds.filter((id) => id !== fieldId)

    return { ...group, fieldIds }
  })
}

/** Result of {@link assignFieldToGroupInOrder} — membership and order move together. */
export interface AssignFieldInOrderResult {
  fieldOrder: string[]
  groups: FieldGroupLike[]
}

/**
 * Move a field into a group (or out of every group with `groupId: null`) AND
 * relocate it in `fieldOrder` so the group's block does not move.
 *
 * Why this is not just {@link reassignFieldToGroup} + {@link normalizeGroupContiguity}:
 * normalization anchors a block at its FIRST member. A field joining from above
 * the block becomes that first member, so the whole group would be dragged up to
 * the joining field's old slot, displacing every ungrouped field in between —
 * i.e. dropping one field into a group would silently relocate the group. This
 * relocates the joining field next to the block's existing members first, so the
 * anchor is unchanged and only the joining field moves.
 *
 * The field lands at the END of the target group's block; callers that want a
 * precise intra-group slot should follow this with a reorder against the
 * returned order. **That follow-up reorder must name its edge** — this function
 * has just moved the field to the block's tail, so an `arrayMove` against a
 * member would read the gesture as travelling upward and land the field one slot
 * early (see {@link moveFieldToSlot}).
 *
 * A target group with no surviving members sends the field to wherever
 * {@link groupFieldOrder} draws that empty group — just before its
 * `anchorFieldId`, or the END of `fieldOrder` when it has no live anchor.
 * Leaving the field in place would instead give the group the field's position
 * and move the group. No-ops on the order when the field is absent from
 * `fieldOrder`. Never mutates the inputs.
 */
export function assignFieldToGroupInOrder(params: {
  fieldOrder: string[]
  groups: FieldGroupLike[]
  fieldId: string
  groupId: string | null
}): AssignFieldInOrderResult {
  const { fieldOrder, groups, fieldId, groupId } = params
  const reassigned = reassignFieldToGroup({ groups, fieldId, groupId })

  // Membership unchanged (the field is already in the target group, or already
  // ungrouped) → the order must be left ALONE. Relocating here would move a
  // field on a same-group drag, so a caller doing the usual
  // assign-then-reorder would move it twice and land it a slot off.
  const wasMember = groups.some((g) => g.id === groupId && g.fieldIds.includes(fieldId))
  if (wasMember) return { fieldOrder, groups: reassigned }

  const from = fieldOrder.indexOf(fieldId)

  /**
   * The group the field is LEAVING, when this is its last surviving member.
   *
   * It is about to lose the only thing giving it a position, so pin it to where
   * it renders right now — otherwise it falls back to the end of the list (or,
   * worse, to a stale `anchorFieldId` from before it was ever filled, which is
   * where it was last seen jumping to).
   *
   * The anchor is the field that FOLLOWS the departing one, read from the
   * order as it stands before the move. Anchoring to the departing field itself
   * would be wrong: the caller usually reorders it straight afterwards, and the
   * emptied group would then travel with it. Blocks are contiguous, so the
   * successor is always either ungrouped or the first member of the next group
   * — never mid-block, which the walk would ignore. No successor means the
   * block sat last, and no anchor already means "at the end".
   */
  const sourceGroup = groups.find((g) => g.id !== groupId && g.fieldIds.includes(fieldId))
  const sourceEmptied =
    sourceGroup !== undefined &&
    !sourceGroup.fieldIds.some((id) => id !== fieldId && fieldOrder.includes(id))
  const successorId = from === -1 ? undefined : fieldOrder[from + 1]

  const nextGroups =
    sourceEmptied && sourceGroup
      ? reassigned.map((g) => (g.id === sourceGroup.id ? { ...g, anchorFieldId: successorId } : g))
      : reassigned

  const target = groupId ? nextGroups.find((g) => g.id === groupId) : undefined
  if (!target)
    return { fieldOrder: normalizeGroupContiguity(fieldOrder, nextGroups), groups: nextGroups }

  const siblings = new Set(target.fieldIds.filter((id) => id !== fieldId))
  let lastSibling = -1
  for (let i = 0; i < fieldOrder.length; i++) {
    if (siblings.has(fieldOrder[i] as string)) lastSibling = i
  }
  if (from === -1) {
    return { fieldOrder: normalizeGroupContiguity(fieldOrder, nextGroups), groups: nextGroups }
  }

  const next = [...fieldOrder]
  next.splice(from, 1)

  /**
   * An EMPTY group has no member to land beside, so the field goes to wherever
   * that group is currently DRAWN — otherwise the group inherits the field's
   * position instead and visibly jumps to meet it.
   *
   * `groupFieldOrder` draws an empty group immediately before its
   * `anchorFieldId`, or at the very end when it has none (or the anchor is a
   * deleted field). Both cases have to be mirrored here, and the anchor case is
   * the one that matters most: a group the user has just dragged up the panel
   * must not snap back to the bottom the moment it gets its first field.
   */
  const emptyGroupInsertAt = (): number => {
    const anchorFieldId = target.anchorFieldId
    if (anchorFieldId === undefined) return next.length
    // The anchor IS the field being dropped in: the group already renders just
    // above it, so keeping the field's own slot leaves the group where it is.
    if (anchorFieldId === fieldId) return Math.min(from, next.length)
    const anchorIndex = next.indexOf(anchorFieldId)
    return anchorIndex === -1 ? next.length : anchorIndex
  }

  // With members, the field lands after the block's last one. Removing it first
  // shifts indices left when it sat before the block, hence the two cases.
  const insertAt =
    lastSibling === -1 ? emptyGroupInsertAt() : from < lastSibling ? lastSibling : lastSibling + 1
  next.splice(insertAt, 0, fieldId)

  return { fieldOrder: normalizeGroupContiguity(next, nextGroups), groups: nextGroups }
}

export interface MoveFieldToSlotParams {
  fieldOrder: string[]
  /** The field being moved. */
  fieldId: string
  /** The field whose slot it is aimed at. */
  overId: string
  /**
   * Which side of `overId` the field lands on.
   *
   * **Omit for dnd-kit's `arrayMove` semantics**, which are direction-dependent:
   * the destination index is read BEFORE the source is spliced out, so removing
   * an element that sat earlier shifts everything left and the field lands
   * AFTER the target — while a field that sat later lands ON it, i.e. before.
   * A flat `SortableContext` drag wants exactly that, because the row has
   * already been displaced on screen.
   *
   * **Pass it when a drop and its affordance must agree.** The property panel's
   * insert line is drawn from the ORIGINAL positions, so any step that relocates
   * the field before the reorder — joining a group appends it to the block's
   * tail — inverts the arrayMove direction and lands it one slot early. Naming
   * the side removes the dependency: the target index is recomputed after the
   * removal, so the result is the same whichever way the field travelled.
   */
  edge?: 'before' | 'after'
}

/**
 * Move a field to another field's slot in `fieldOrder`.
 *
 * Returns the input array by reference when either id is missing or the move is
 * a no-op, so callers can skip a state write. Never mutates the input, and never
 * touches group membership — run {@link normalizeGroupContiguity} afterwards if
 * the move may have split a block.
 */
export function moveFieldToSlot(params: MoveFieldToSlotParams): string[] {
  const { fieldOrder, fieldId, overId, edge } = params

  const from = fieldOrder.indexOf(fieldId)
  const to = fieldOrder.indexOf(overId)
  if (from === -1 || to === -1 || from === to) return fieldOrder

  const next = [...fieldOrder]
  next.splice(from, 1)

  if (edge === undefined) {
    next.splice(to, 0, fieldId)
    return next
  }

  const target = next.indexOf(overId)
  next.splice(edge === 'after' ? target + 1 : target, 0, fieldId)
  return next
}

export interface ResolveEmptyGroupAnchorParams {
  fieldOrder: string[]
  groups: FieldGroupLike[]
  /** The EMPTY group being dragged. */
  groupId: string
  /** Drop target: a field id, or another group's id. */
  overId: string
  /** True when `overId` names a group rather than a field. */
  overIsGroup: boolean
}

/**
 * Where a dragged EMPTY group should come to rest, as an `anchorFieldId`.
 *
 * {@link moveGroupBlock} cannot answer this: it works by lifting a group's
 * member rows out of `fieldOrder` and splicing them back at a new index, and an
 * empty group has no rows to lift. So an empty group is repositioned by naming
 * the field it renders BEFORE, which {@link groupFieldOrder} then honours.
 *
 * **Before, not after.** The insert line for an empty group is always drawn on
 * its target's TOP edge — `edgeFor` needs the block's own first member to know
 * which way it travelled, and there isn't one — so "before the target" is the
 * position the affordance actually promises. It also leaves the end of the list
 * reachable as the no-anchor default, which an "after" encoding would not.
 *
 * Decisions this function pins down:
 * - **A drop snaps to a group boundary**, exactly as `moveGroupBlock` does: a
 *   field belonging to another group resolves to that group's FIRST surviving
 *   member, so the empty group lands above that whole block instead of inside
 *   it. `groupFieldOrder` only fires anchors where a section starts, so an
 *   anchor pointing mid-block would silently do nothing.
 * - **Returns null for anything unresolvable** — an unknown group, a target
 *   that is the moving group itself, a target group with no surviving members,
 *   a field absent from `fieldOrder` — so the caller writes nothing.
 * - **The caller is responsible for only calling this on an empty group.** A
 *   populated group has a real derived position and must go through
 *   `moveGroupBlock`.
 *
 * Never mutates its inputs.
 */
export function resolveEmptyGroupAnchor(
  params: ResolveEmptyGroupAnchorParams
): { anchorFieldId: string } | null {
  const { fieldOrder, groups, groupId, overId, overIsGroup } = params

  if (!groups.some((group) => group.id === groupId)) return null

  const ownerById = new Map<string, string>()
  for (const group of groups) {
    for (const fieldId of group.fieldIds) {
      if (!ownerById.has(fieldId)) ownerById.set(fieldId, group.id)
    }
  }

  const firstMemberOf = (targetGroupId: string): string | undefined =>
    fieldOrder.find((fieldId) => ownerById.get(fieldId) === targetGroupId)

  if (overIsGroup) {
    if (overId === groupId) return null
    const anchorFieldId = firstMemberOf(overId)
    return anchorFieldId === undefined ? null : { anchorFieldId }
  }

  if (!fieldOrder.includes(overId)) return null

  const ownerGroupId = ownerById.get(overId)
  if (ownerGroupId === undefined) return { anchorFieldId: overId }
  if (ownerGroupId === groupId) return null

  const anchorFieldId = firstMemberOf(ownerGroupId)
  return anchorFieldId === undefined ? null : { anchorFieldId }
}

export interface MoveGroupBlockParams {
  fieldOrder: string[]
  groups: FieldGroupLike[]
  /** The group being dragged. */
  groupId: string
  /** Drop target: a field id, or another group's id. */
  overId: string
  /** True when `overId` names a group rather than a field. */
  overIsGroup: boolean
}

/**
 * Move a whole group — header and every member — to a new position in
 * `fieldOrder`, as one block.
 *
 * Until the header got a drag handle a group could only reposition *implicitly*,
 * by someone moving its first member; a group has no stored index, so "move the
 * group" has to be expressed as "move all of its members at once". That is what
 * this is: lift the group's members out of `fieldOrder` in one piece, resolve
 * one insertion index, splice the piece back in, re-normalise.
 *
 * The arithmetic, in three steps:
 * 1. **Lift.** The block is the moving group's members that actually appear in
 *    `fieldOrder`, in `fieldOrder` order — the same set and order
 *    {@link groupFieldOrder} would put in that group's section, so what moves is
 *    exactly what the user sees under that header. Removing it leaves the
 *    *reduced* array.
 * 2. **Resolve against the reduced array, not the original.** Every index is
 *    read from the reduced array, so the leftward shift caused by lifting a
 *    block that sat *above* the target needs no ad-hoc `- blockLength`
 *    correction — it is already baked in. What is left is a direction rule, the
 *    same one {@link assignFieldToGroupInOrder}'s `from < lastSibling` ternary
 *    encodes: dragging **up** lands the block *at* the target's position (insert
 *    at the target's first surviving member), dragging **down** lands it *after*
 *    the target's block (insert after the target's last surviving member).
 *    Without the split, a downward drag would insert above the target it was
 *    dropped on and read as "nothing happened".
 * 3. **Splice and normalise.** {@link normalizeGroupContiguity} closes over the
 *    result, so scattered input is repaired on the way out and the return value
 *    is a fixpoint.
 *
 * Decisions this function pins down:
 * - **A group always lands on a group boundary.** Dropping onto a field that
 *   belongs to *another* group snaps to that group's block — before its first
 *   member, or after its last — never between two of its members. Landing inside
 *   another block would split it, and contiguity is precisely what makes
 *   "position in `fieldOrder`" a well-defined answer to "where does this group
 *   render" and makes a drop index readable back as membership. (The result
 *   would be re-gathered by normalisation anyway, but at the *other* group's
 *   anchor — so the dragged group would visibly jump somewhere the user did not
 *   drop it.) Dropping onto an *ungrouped* field has no such constraint and
 *   inserts at that field.
 * - **Dropping a group on itself, or on one of its own members, is a no-op** —
 *   it still returns a normalised array, so callers can write the result back
 *   unconditionally without a "did anything change" branch.
 * - **Direction is decided by the block's FIRST member**, matching the anchor
 *   rule the rest of this module uses. For a normalised order the block is
 *   contiguous and entirely on one side of the target, so first-vs-last cannot
 *   differ; the tie-break only matters for malformed scattered input.
 * - **Ownership is first-group-wins**, exactly as {@link groupFieldOrder}
 *   resolves it, so a field claimed by two groups moves with the earlier one and
 *   the two functions can never disagree about what a block contains.
 * - **Everything unresolvable is a no-op**, never a throw: an unknown `groupId`
 *   or `overId`, an `overIsGroup` id that matches no group, a moving group whose
 *   members are all ghosts, an empty `fieldOrder`. A group deleted between
 *   render and drop must not wedge the panel.
 * - **A target group with no surviving members is also a no-op.** Empty groups
 *   render pinned at the end (`includeEmptyGroups`) purely as a UI convention —
 *   they have no position in `fieldOrder` by construction, so there is no index
 *   to resolve and no honest answer other than "don't move".
 * - **Duplicate ids collapse to their first occurrence** before anything is
 *   measured, matching `mergeFieldOrder` and {@link groupFieldOrder}.
 *
 * Ungrouped fields keep their relative order — the only movement is the block
 * itself. Invariant: the result is a permutation of the deduplicated
 * `fieldOrder`, no losses and no duplicates.
 *
 * Never mutates its inputs.
 */
export function moveGroupBlock(params: MoveGroupBlockParams): string[] {
  const { fieldOrder, groups, groupId, overId, overIsGroup } = params

  // Collapse duplicates once, up front: every index below is read off this
  // array, and normalisation would collapse them on the way out regardless.
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const fieldId of fieldOrder) {
    if (seen.has(fieldId)) continue
    seen.add(fieldId)
    deduped.push(fieldId)
  }

  const noOp = () => normalizeGroupContiguity(deduped, groups)

  const ownerByField = new Map<string, number>()
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index] as FieldGroupLike
    for (const fieldId of group.fieldIds) {
      if (!ownerByField.has(fieldId)) ownerByField.set(fieldId, index)
    }
  }

  const movingIndex = groups.findIndex((group) => group.id === groupId)
  if (movingIndex === -1) return noOp()

  const block = deduped.filter((fieldId) => ownerByField.get(fieldId) === movingIndex)
  if (block.length === 0) return noOp()

  // Which group, if any, the drop landed on. A field target resolves to its
  // owner so the insertion snaps to that group's boundary.
  let targetIndex: number
  if (overIsGroup) {
    targetIndex = groups.findIndex((group) => group.id === overId)
    if (targetIndex === -1) return noOp()
  } else {
    targetIndex = ownerByField.get(overId) ?? -1
  }
  if (targetIndex === movingIndex) return noOp()

  const targetMembers =
    targetIndex === -1
      ? deduped.filter((fieldId) => fieldId === overId)
      : deduped.filter((fieldId) => ownerByField.get(fieldId) === targetIndex)

  const anchorId = targetMembers[0]
  const lastTargetId = targetMembers[targetMembers.length - 1]
  if (anchorId === undefined || lastTargetId === undefined) return noOp()

  const reduced = deduped.filter((fieldId) => ownerByField.get(fieldId) !== movingIndex)
  // Indices are read from `reduced`, so the lift's leftward shift is already
  // applied; only the drag direction is left to account for.
  const blockSatBefore = deduped.indexOf(block[0] as string) < deduped.indexOf(anchorId)
  const insertAt = blockSatBefore ? reduced.indexOf(lastTargetId) + 1 : reduced.indexOf(anchorId)

  const next = [...reduced]
  next.splice(insertAt, 0, ...block)

  return normalizeGroupContiguity(next, groups)
}
