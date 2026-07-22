// apps/web/src/components/dispatch/ui/board/group-drag.ts
//
// Pure delta math for group drag-move (plan `37c-calendar-create-copy-paste.md` §6). No React,
// no store reads — `computeGroupDragUpdates` is unit-tested directly (`group-drag.test.ts`).

import type { DispatchVisitEvent } from './types'

/** One non-dragged selected visit's commit — mirrors `dispatch.scheduleVisit`'s input shape.
 * `assigneeUserId: undefined` means "omit the key" (the scheduleVisit gotcha, plan 37c §2.5):
 * `undefined` must never be conflated with `null` (explicitly unassigned). */
export interface GroupDragUpdate {
  visitId: string
  startTime: Date
  endTime: Date
  assigneeUserId?: string | null
}

/**
 * §6: every OTHER selected visit shifts by the SAME delta the dragged chip moved (relative
 * offsets preserved) via plain millisecond arithmetic on each visit's own `start`/`end` — this
 * also covers a month-view whole-day drag for free (a day's worth of milliseconds shifts the
 * date, not just the time-of-day). Assignee is carried ONLY when `groupAssigneeUserId` is
 * anything other than `undefined` — the caller resolves that once (comparing the drop's
 * resolved worker against the dragged chip's OWN original resource column) so every row here
 * gets identical assignee semantics: all-or-nothing, never a per-row guess.
 *
 * Returns one row per id in `groupIds` EXCLUDING `draggedEventId` — the caller already has its
 * own `scheduleVisit` call for the chip dnd-kit actually dragged.
 */
export function computeGroupDragUpdates(
  draggedEventId: string,
  originalStart: Date,
  newStart: Date,
  groupIds: string[],
  eventsById: ReadonlyMap<string, DispatchVisitEvent>,
  groupAssigneeUserId: string | null | undefined
): GroupDragUpdate[] {
  const deltaMs = newStart.getTime() - originalStart.getTime()
  const updates: GroupDragUpdate[] = []

  for (const id of groupIds) {
    if (id === draggedEventId) continue
    const event = eventsById.get(id)
    if (!event) continue // Selected id no longer in the fetched window — skip, don't guess.

    updates.push({
      visitId: id,
      startTime: new Date(new Date(event.start).getTime() + deltaMs),
      endTime: new Date(new Date(event.end).getTime() + deltaMs),
      assigneeUserId: groupAssigneeUserId,
    })
  }

  return updates
}
