// apps/web/src/components/fields/hooks/use-field-group-dnd.ts
'use client'

import type { FieldGroup, FieldViewConfig } from '@auxx/lib/conditions/client'
import type { DragEndEvent } from '@dnd-kit/core'
import { useCallback } from 'react'
import { parseGroupDropId } from '~/components/fields/rows/field-group-row'

export interface UseFieldGroupDndOptions {
  /** The draft being edited. Only `fieldOrder` is read (display order of members). */
  draft: FieldViewConfig | null
  /** The draft's groups. */
  draftGroups: FieldGroup[]
  /** From `useFieldViewDraft` — moves membership AND position together. */
  assignFieldToGroup: (fieldId: string, groupId: string | null) => void
  /** From `useFieldViewDraft` — `edge` names the side of `overId` to land on. */
  reorderDraft: (activeId: string, overId: string, edge?: 'before' | 'after') => void
}

export interface UseFieldGroupDndResult {
  /** The FIELD half of drag-end routing (`FieldGroupList` splits by what was dragged). */
  handleFieldDragEnd: (event: DragEndEvent, edge?: 'before' | 'after') => void
  /** Land a field immediately before/after a group's block, belonging to no group. */
  placeFieldBesideGroup: (fieldId: string, groupId: string, side: 'before' | 'after') => void
}

/**
 * The glue between `FieldGroupList`'s drop routing and `useFieldViewDraft`'s
 * mutators — pure draft manipulation, no rendering, so both the property panel
 * and the record dialog consume the identical drop semantics.
 */
export function useFieldGroupDnd({
  draft,
  draftGroups,
  assignFieldToGroup,
  reorderDraft,
}: UseFieldGroupDndOptions): UseFieldGroupDndResult {
  /** The group a field currently belongs to in the draft, or null if ungrouped. */
  const draftGroupIdOf = useCallback(
    (fieldId: string): string | null =>
      draftGroups.find((group) => group.fieldIds.includes(fieldId))?.id ?? null,
    [draftGroups]
  )

  /**
   * The FIELD half of the drag-end routing (`FieldGroupList.routeDragEnd`
   * splits by what is being dragged, and sends group-header drags to
   * `moveGroup` instead — a block move changes order only, never membership).
   *
   * Reordering moves the field within the DRAFT's `fieldOrder`. The dnd ids are
   * the same ids `fieldOrder` stores — mismatched ids would make this a silent
   * no-op.
   *
   * Group membership is derived from where the field LANDED: because a group's
   * members are contiguous, the row a field is dropped among identifies exactly
   * one group (or none, outside every block), and that is the drop's intent. A
   * drop on a group HEADER addresses the group directly — headers are drop
   * targets for every block now that they are sortables in their own right, so
   * this is how a field joins a group whose members it cannot aim at (an empty
   * or collapsed one) as well as one it can.
   *
   * Membership is applied FIRST, then the reorder: `assignFieldToGroup` moves
   * membership and position together so the target block keeps its anchor, and
   * the reorder that follows settles the field into the exact slot it was
   * dropped on. Both are functional `setDraft` updaters, so the second observes
   * the first within this handler. A same-group drag skips the assignment — it
   * is a no-op on membership but not on position, so running it would move the
   * field twice.
   *
   * `edge` is why the reorder cannot be a bare `arrayMove`. Joining a group
   * relocates the field to the block's TAIL, so a field dragged DOWN into a
   * group arrives above its target having travelled up — and an arrayMove reads
   * direction from the post-assignment position, landing it one slot early
   * (dropping on the last member put it second-to-last). The caller passes the
   * same edge the insert line was drawn from, so the drop lands where the line
   * promised.
   */
  const handleFieldDragEnd = useCallback(
    (event: DragEndEvent, edge?: 'before' | 'after') => {
      const { active, over } = event
      if (!over) return

      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return

      const currentGroupId = draftGroupIdOf(activeId)

      // Header drop. An EMPTY group has no members to aim at, so the header is
      // the only target and assign-only is right — the field keeps its position
      // and the group forms around it. A group that HAS members is different:
      // assign-only would silently append the field to the end of the block, so
      // a drop near the top of a group would fling the row to its bottom. Land
      // it at the head of the block instead, which is what dropping on a header
      // reads as.
      const headerGroupId = parseGroupDropId(overId)
      if (headerGroupId) {
        if (headerGroupId !== currentGroupId) assignFieldToGroup(activeId, headerGroupId)
        const firstMemberId = draftGroups
          .find((group) => group.id === headerGroupId)
          ?.fieldIds.find((id) => id !== activeId)
        // `before` states the intent outright — dropping on a header means the
        // head of the block, whichever direction the field travelled from. An
        // EMPTY group has no first member, and none is needed: the assignment
        // has already sent the field to where an empty group renders.
        if (firstMemberId) reorderDraft(activeId, firstMemberId, 'before')
        return
      }

      const targetGroupId = draftGroupIdOf(overId)

      if (targetGroupId !== currentGroupId) assignFieldToGroup(activeId, targetGroupId)
      reorderDraft(activeId, overId, edge)
    },
    [assignFieldToGroup, draftGroupIdOf, draftGroups, reorderDraft]
  )

  /**
   * Land a field BESIDE a group's block, belonging to no group.
   *
   * This is the position the drag model had no vocabulary for, and its absence
   * was a real trap: with only row ids as drop targets, every target near a
   * group reads as "join that group", so a group rendered first in the panel
   * swallowed any field dragged toward the top of the list. The `-before` /
   * `-after-group` droppables name those two positions; this applies them.
   *
   * Why the round trip THROUGH the group rather than `assignFieldToGroup(null)`
   * plus a reorder: aiming at the group's first member is direction-sensitive
   * unless the edge is named. Joining the block first puts the field at a known
   * end of it, and leaving the block then keeps that slot —
   * `assignFieldToGroupInOrder` re-anchors the block at its first remaining
   * MEMBER, so a departing field at the head floats above the block and one at
   * the tail floats below it. The result is the same in both drag directions.
   *
   * All three writes are functional `setDraft` updaters, so each observes the
   * previous one within this handler.
   */
  const placeFieldBesideGroup = useCallback(
    (fieldId: string, groupId: string, side: 'before' | 'after') => {
      const memberSet = new Set(draftGroups.find((g) => g.id === groupId)?.fieldIds ?? [])

      // Members in DISPLAY order, from `fieldOrder` — NOT the group's own
      // `fieldIds` array. Membership is a set whose array order is only a
      // tie-break; it drifts from the rendered order the moment anything is
      // reordered inside the group. Reading `fieldIds[0]` as "the top of the
      // block" therefore aimed step 2 at an arbitrary member, and a field
      // dropped ABOVE a group landed in the middle of it — from where step 3's
      // re-normalisation pushed it out BELOW the whole block.
      const memberIds = (draft?.fieldOrder ?? []).filter(
        (id) => id !== fieldId && memberSet.has(id)
      )

      // 1. Join the block — `assignFieldToGroup` places it at the block's end
      //    without moving the block itself.
      assignFieldToGroup(fieldId, groupId)

      // 2. For `before`, pull it to the head; for `after` it is already at the
      //    tail, since step 1 appends.
      const firstMemberId = memberIds[0]
      if (side === 'before' && firstMemberId) reorderDraft(fieldId, firstMemberId, 'before')

      // 3. Leave every group, keeping the slot just established.
      assignFieldToGroup(fieldId, null)
    },
    [assignFieldToGroup, draft, draftGroups, reorderDraft]
  )

  return { handleFieldDragEnd, placeFieldBesideGroup }
}
