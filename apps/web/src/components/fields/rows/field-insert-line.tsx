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

/** Suffix for "the last slot INSIDE this group", after its final member. */
export const GROUP_END_SUFFIX = '-end'

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

/** Droppable id for the last slot INSIDE a group, after its final member. */
export function groupEndDropId(groupId: string): string {
  return `${GROUP_DROP_PREFIX}${groupId}${GROUP_END_SUFFIX}`
}

/**
 * What a droppable id means, once its suffix is parsed off.
 *
 * - `field` — land at that row's slot, on the side the drag came FROM: down
 *   onto a row lands after it, up onto a row lands before it. Direction is the
 *   right rule for a row's body, where the gesture is "past this row".
 * - `field-before` — land immediately above that row, whatever the direction.
 *
 * The two used to be one: a `-before` id had its suffix stripped and resolved
 * to the bare row, handing its meaning back to `edgeFor`. That made a NAMED
 * boundary direction-dependent, and next to a group it produced a genuine
 * inversion — the band above a row meant "above it" while the group zone just
 * above THAT meant "below the last member", so moving the pointer up moved the
 * insert position down. A zone that names a boundary now decides its own edge.
 * - `group-into` — join the group (the bare header id).
 * - `group-before` / `group-after` — land beside the block, in no group.
 * - `group-end` — join the group at its LAST slot, after the final member.
 *
 * `group-end` exists because a row target's edge is derived from the drag's
 * DIRECTION (`edgeFor`): dragging down onto a row lands after it, dragging up
 * lands before it. So an upward drag can never express "after this row", and
 * for a group's final member that made the group's own last slot unreachable —
 * the field had to be dropped into the group somewhere else and reordered in a
 * second gesture. This names the slot outright, so it means the same thing from
 * either direction.
 */
export type FieldDropTarget =
  | { kind: 'field'; fieldId: string }
  | { kind: 'field-before'; fieldId: string }
  | { kind: 'group-into'; groupId: string }
  | { kind: 'group-before'; groupId: string }
  | { kind: 'group-after'; groupId: string }
  | { kind: 'group-end'; groupId: string }

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
  if (overId.endsWith(GROUP_END_SUFFIX)) {
    const groupId = parseGroupDropId(overId.slice(0, -GROUP_END_SUFFIX.length))
    if (groupId !== null) return { kind: 'group-end', groupId }
  }
  if (overId.endsWith(BEFORE_SUFFIX)) {
    const bare = overId.slice(0, -BEFORE_SUFFIX.length)
    const groupId = parseGroupDropId(bare)
    return groupId !== null
      ? { kind: 'group-before', groupId }
      : { kind: 'field-before', fieldId: bare }
  }
  const groupId = parseGroupDropId(overId)
  return groupId !== null ? { kind: 'group-into', groupId } : { kind: 'field', fieldId: overId }
}

interface FieldDropZoneProps {
  /** One of the ids minted above. */
  id: string
  /**
   * Where in the positioned parent this zone sits:
   * - `top` — straddling the top boundary
   * - `inner-bottom` — inside the block, just above its closing edge
   * - `bottom` — the closing edge itself
   */
  edge: 'top' | 'inner-bottom' | 'bottom'
}

/**
 * The invisible hit area a boundary is targeted by.
 *
 * `pointer-events-none` on purpose — dnd-kit resolves collisions from measured
 * rects, never from pointer events, so the zone can overlap a row's own controls
 * without swallowing clicks.
 *
 * A `top` zone STRADDLES its boundary; the two bottom zones sit INSIDE the block
 * they close. That asymmetry is load bearing: an ungrouped row following a group
 * has no top margin, so a bottom zone straddling the block's edge would occupy
 * the identical 16px band as that row's `-top-2 h-4` leading zone — and the two
 * mean slots one row apart, so the tie would decide the drop.
 */
/**
 * The last member's row is ~30px, and its bottom is where three different
 * answers compete. They are stacked, not overlapped, so each owns real estate:
 *
 *   30px ┬ ── row body / its own `-before` band above ─ "before the last member"
 *        │
 *   24px ┼ ── inner-bottom ──────────────────────────── "inside, last slot"
 *        │
 *   12px ┼ ── bottom ─────────────────────────────────── "below the block, out"
 *        │
 *    0px ┴
 *
 * Sizing them equally matters, and both directions were tried the hard way: a
 * 16px `bottom` swallowed the whole lower half and made the group's own last
 * slot unreachable, then correcting it to 8px made LEAVING the group the hard
 * one. Height alone cannot settle it either — `pointerWithin` ranks by distance
 * to each droppable's CENTRE, and a band inside a 30px row has a centre within a
 * pixel or two of the row's own, so `inner-bottom` is additionally given
 * precedence in `collisionDetection` rather than left to win on proximity.
 */
const ZONE_POSITION: Record<FieldDropZoneProps['edge'], string> = {
  top: '-top-2 h-4',
  'inner-bottom': 'bottom-3 h-3',
  bottom: 'bottom-0 h-3',
}

export function FieldDropZone({ id, edge }: FieldDropZoneProps) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn('pointer-events-none absolute right-0 left-0 z-0', ZONE_POSITION[edge])}
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
