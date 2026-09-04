// apps/web/src/components/grouped-drag-list/drop-zone.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'

interface GroupedDropZoneProps {
  /** One of the ids minted in `drop-targets.ts`. */
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
const ZONE_POSITION: Record<GroupedDropZoneProps['edge'], string> = {
  top: '-top-2 h-4',
  'inner-bottom': 'bottom-3 h-3',
  bottom: 'bottom-0 h-3',
}

/** Registers one droppable boundary of the grouped list's keyspace. */
export function GroupedDropZone({ id, edge }: GroupedDropZoneProps) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn('pointer-events-none absolute right-0 left-0 z-0', ZONE_POSITION[edge])}
    />
  )
}

interface GroupedInsertLineProps {
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
 * The 2px landing indicator. Rendered by the list only for the boundary the
 * current drag actually resolves to, so it is always "on" when mounted.
 */
export function GroupedInsertLine({ side, inset = false }: GroupedInsertLineProps) {
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
