// apps/web/src/components/fields/rows/field-insert-line.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { GROUP_DROP_PREFIX, parseGroupDropId } from './field-group-row'

/**
 * The drop-target keyspace for the property panel's edit-mode drag, plus the
 * 2px line that renders it.
 *
 * The panel does NOT use a `SortableContext`: nothing displaces while a drag is
 * in flight, so "where will this land" has to be stated explicitly. That is what
 * these ids are for — every position a drop can express has a droppable of its
 * own, and exactly one line is drawn at a time. Ported from the KB sidebar
 * (`components/kb/ui/sidebar/article-insert-line.tsx`), minus the "+" create
 * menu: this is the drop affordance only.
 *
 * The keyspace has one rule worth memorising:
 *
 * > **A suffix addresses the position NEXT TO a thing; a bare id addresses the
 * > thing itself.**
 *
 * So `fieldgroup:g1` means "join this group" while `fieldgroup:g1-before` means
 * "sit above this group's block, in no group at all". Without that distinction a
 * group that renders first in the panel is a roach motel: every droppable near
 * it resolves to one of its members, and `handleDragEnd` reads a member as
 * "join that member's group", so the position above the block is unreachable.
 */

/** Suffix for "the boundary above this row/block". */
export const BEFORE_SUFFIX = '-before'

/** Suffix for "the boundary below this group's whole block". */
export const AFTER_GROUP_SUFFIX = '-after-group'

/** Droppable id for the boundary above a field row. */
export function fieldBeforeDropId(fieldId: string): string {
  return `${fieldId}${BEFORE_SUFFIX}`
}

/** Droppable id for a group itself — the header's own `useSortable` registration. */
export function groupDropId(groupId: string): string {
  return `${GROUP_DROP_PREFIX}${groupId}`
}

/** Droppable id for the boundary above a group's header. */
export function groupBeforeDropId(groupId: string): string {
  return `${GROUP_DROP_PREFIX}${groupId}${BEFORE_SUFFIX}`
}

/** Droppable id for the boundary below a group's last member. */
export function groupAfterDropId(groupId: string): string {
  return `${GROUP_DROP_PREFIX}${groupId}${AFTER_GROUP_SUFFIX}`
}

/**
 * What a droppable id means, once its suffix is parsed off.
 *
 * - `field` — land at that row's slot. Both the row's own `useSortable`
 *   droppable and its `-before` line resolve here: they are two hit areas for
 *   one outcome, which is what makes targeting robust near a row boundary.
 * - `group-into` — join the group (the bare header id).
 * - `group-before` / `group-after` — land beside the block, in no group.
 */
export type FieldDropTarget =
  | { kind: 'field'; fieldId: string }
  | { kind: 'group-into'; groupId: string }
  | { kind: 'group-before'; groupId: string }
  | { kind: 'group-after'; groupId: string }

/**
 * Parse a dnd `over` id back into the drop it expresses.
 *
 * Suffixes are stripped before the `fieldgroup:` prefix is read, so the two
 * never fight: `fieldgroup:g1-before` is a group target, `abc:def-before` is a
 * field target. An id carrying no suffix and no prefix is a bare field row.
 */
export function resolveDropTarget(overId: string): FieldDropTarget {
  if (overId.endsWith(AFTER_GROUP_SUFFIX)) {
    const groupId = parseGroupDropId(overId.slice(0, -AFTER_GROUP_SUFFIX.length))
    if (groupId !== null) return { kind: 'group-after', groupId }
  }
  if (overId.endsWith(BEFORE_SUFFIX)) {
    const bare = overId.slice(0, -BEFORE_SUFFIX.length)
    const groupId = parseGroupDropId(bare)
    return groupId !== null ? { kind: 'group-before', groupId } : { kind: 'field', fieldId: bare }
  }
  const groupId = parseGroupDropId(overId)
  return groupId !== null ? { kind: 'group-into', groupId } : { kind: 'field', fieldId: overId }
}

interface FieldDropZoneProps {
  /** One of the ids minted above. */
  id: string
  /** Which edge of the positioned parent this zone straddles. */
  edge: 'top' | 'bottom'
}

/**
 * The invisible hit area a boundary is targeted by.
 *
 * `pointer-events-none` on purpose — dnd-kit resolves collisions from measured
 * rects, never from pointer events, so the zone can overlap a row's own controls
 * without swallowing clicks.
 *
 * The two edges are deliberately NOT symmetric. A `top` zone straddles its
 * boundary (`-top-2 h-4`) while a `bottom` zone sits just inside the block it
 * closes (`bottom-0 h-4`). A group's trailing zone and the next row's leading
 * zone describe the same seam, and two droppables with identical rects make
 * `closestCorners` pick by registration order rather than by where the pointer
 * actually is.
 */
export function FieldDropZone({ id, edge }: FieldDropZoneProps) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'pointer-events-none absolute right-0 left-0 z-0 h-4',
        edge === 'top' ? '-top-2' : 'bottom-0'
      )}
    />
  )
}

interface FieldInsertLineProps {
  /** Which edge of the positioned parent the line sits on. */
  side: 'top' | 'bottom'
  /**
   * Narrow the line to the leading indent strip instead of spanning the row.
   * Used for a group's trailing line so it cannot be read as the last member's
   * own boundary — the two sit at the same y.
   */
  inset?: boolean
}

/**
 * The 2px landing indicator. Rendered by the caller only for the boundary the
 * current drag actually resolves to, so it is always "on" when mounted.
 */
export function FieldInsertLine({ side, inset = false }: FieldInsertLineProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-20 h-[2px] bg-blue-500',
        side === 'top' ? '-top-px' : '-bottom-px',
        inset ? 'left-0 w-6' : 'right-0 left-0'
      )}
    />
  )
}
