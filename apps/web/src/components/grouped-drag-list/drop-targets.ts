// apps/web/src/components/grouped-drag-list/drop-targets.ts

/**
 * The drop-target keyspace for {@link GroupedDragList}'s edit-mode drag.
 *
 * The list does NOT use a `SortableContext`: nothing displaces while a drag is
 * in flight, so "where will this land" has to be stated explicitly. That is what
 * these ids are for — every position a drop can express has a droppable of its
 * own, and exactly one insert line is drawn at a time. Ported from the KB
 * sidebar (`components/kb/ui/sidebar/article-insert-line.tsx`), minus the "+"
 * create menu: this is the drop affordance only.
 *
 * The keyspace has one rule worth memorising:
 *
 * > **A suffix addresses the position NEXT TO a thing; a bare id addresses the
 * > thing itself.**
 *
 * So `group:g1` means "join this group" while `group:g1-before` means "sit above
 * this group's block, in no group at all". Without that distinction a group that
 * renders first in the list is a roach motel: every droppable near it resolves
 * to one of its members, and the drag-end router reads a member as "join that
 * member's group", so the position above the block is unreachable.
 */

/**
 * Prefix for a group header's dnd id.
 *
 * The header is a sortable of its own: it is the drag SOURCE for moving the
 * whole block, and the drop TARGET that makes an item join the group.
 * {@link parseGroupDropId} is what tells a group id and an item id apart in the
 * drag-end router, so **an item id may never begin with this prefix**. The
 * property panel's item ids are `resourceFieldId`s (`<cuid>:<fieldId>`), which
 * cannot.
 */
export const GROUP_DROP_PREFIX = 'group:'

/** The group id when a dnd `active`/`over` id addresses a group header, else null. */
export function parseGroupDropId(dndId: string): string | null {
  return dndId.startsWith(GROUP_DROP_PREFIX) ? dndId.slice(GROUP_DROP_PREFIX.length) : null
}

/** Suffix for "the boundary above this row/block". */
export const BEFORE_SUFFIX = '-before'

/** Suffix for "the boundary below this group's whole block". */
export const AFTER_GROUP_SUFFIX = '-after-group'

/** Suffix for "the last slot INSIDE this group", after its final member. */
export const GROUP_END_SUFFIX = '-end'

/** Droppable id for the boundary above an item's row. */
export function itemBeforeDropId(itemId: string): string {
  return `${itemId}${BEFORE_SUFFIX}`
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
 * - `item` — land at that row's slot, on the side the drag came FROM: down onto
 *   a row lands after it, up onto a row lands before it. Direction is the right
 *   rule for a row's body, where the gesture is "past this row".
 * - `item-before` — land immediately above that row, whatever the direction.
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
 * the item had to be dropped into the group somewhere else and reordered in a
 * second gesture. This names the slot outright, so it means the same thing from
 * either direction.
 */
export type GroupedDropTarget =
  | { kind: 'item'; itemId: string }
  | { kind: 'item-before'; itemId: string }
  | { kind: 'group-into'; groupId: string }
  | { kind: 'group-before'; groupId: string }
  | { kind: 'group-after'; groupId: string }
  | { kind: 'group-end'; groupId: string }

/**
 * Parse a dnd `over` id back into the drop it expresses.
 *
 * Suffixes are stripped before the {@link GROUP_DROP_PREFIX} is read, so the two
 * never fight: `group:g1-before` is a group target, `abc:def-before` is an item
 * target. An id carrying no suffix and no prefix is a bare item row.
 */
export function resolveDropTarget(overId: string): GroupedDropTarget {
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
      : { kind: 'item-before', itemId: bare }
  }
  const groupId = parseGroupDropId(overId)
  return groupId !== null ? { kind: 'group-into', groupId } : { kind: 'item', itemId: overId }
}
