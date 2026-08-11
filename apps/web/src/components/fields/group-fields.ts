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
 * - With `includeEmptyGroups`, groups with zero surviving members are appended
 *   at the END, after everything else, in `groups` array order — they have no
 *   derived position to render at, by construction. Read mode passes false and
 *   they vanish; edit mode passes true and they become drop targets.
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

  for (const fieldId of fieldOrder) {
    if (consumed.has(fieldId)) continue
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
 * returned order (the two compose — see the tests).
 *
 * No-ops on the order when the target group has no other surviving members
 * (nothing to anchor against) or when the field is absent from `fieldOrder`.
 * Never mutates the inputs.
 */
export function assignFieldToGroupInOrder(params: {
  fieldOrder: string[]
  groups: FieldGroupLike[]
  fieldId: string
  groupId: string | null
}): AssignFieldInOrderResult {
  const { fieldOrder, groups, fieldId, groupId } = params
  const nextGroups = reassignFieldToGroup({ groups, fieldId, groupId })

  // Membership unchanged (the field is already in the target group, or already
  // ungrouped) → the order must be left ALONE. Relocating here would move a
  // field on a same-group drag, so a caller doing the usual
  // assign-then-reorder would move it twice and land it a slot off.
  const wasMember = groups.some((g) => g.id === groupId && g.fieldIds.includes(fieldId))
  if (wasMember) return { fieldOrder, groups: nextGroups }

  const target = groupId ? nextGroups.find((g) => g.id === groupId) : undefined
  if (!target)
    return { fieldOrder: normalizeGroupContiguity(fieldOrder, nextGroups), groups: nextGroups }

  const siblings = new Set(target.fieldIds.filter((id) => id !== fieldId))
  let lastSibling = -1
  for (let i = 0; i < fieldOrder.length; i++) {
    if (siblings.has(fieldOrder[i] as string)) lastSibling = i
  }
  const from = fieldOrder.indexOf(fieldId)
  if (lastSibling === -1 || from === -1) {
    return { fieldOrder: normalizeGroupContiguity(fieldOrder, nextGroups), groups: nextGroups }
  }

  const next = [...fieldOrder]
  next.splice(from, 1)
  // Removing the field shifts indices left when it sat before the block.
  next.splice(from < lastSibling ? lastSibling : lastSibling + 1, 0, fieldId)

  return { fieldOrder: normalizeGroupContiguity(next, nextGroups), groups: nextGroups }
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
