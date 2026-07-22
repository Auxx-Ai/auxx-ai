// apps/web/src/components/dispatch/ui/board/group-drag.test.ts

import { describe, expect, it } from 'vitest'
import { computeGroupDragUpdates } from './group-drag'
import type { DispatchVisitEvent } from './types'

function visit(overrides: Partial<DispatchVisitEvent> & { id: string }): DispatchVisitEvent {
  return {
    id: overrides.id,
    title: overrides.title ?? 'Job',
    start: overrides.start ?? new Date(2024, 0, 1, 9, 0),
    end: overrides.end ?? new Date(2024, 0, 1, 10, 0),
    workOrderId: overrides.workOrderId ?? 'wo-1',
    assigneeUserId: overrides.assigneeUserId ?? null,
    resourceId: overrides.resourceId ?? 'worker-a',
    status: overrides.status ?? 'scheduled',
    dispatchedAt: overrides.dispatchedAt ?? null,
    recurrenceRuleId: overrides.recurrenceRuleId ?? null,
    workOrder: overrides.workOrder ?? undefined,
    timeConfirmedAt: overrides.timeConfirmedAt ?? null,
    timezone: overrides.timezone ?? 'UTC',
    durationMinutes: overrides.durationMinutes ?? 60,
    ...overrides,
  } as DispatchVisitEvent
}

describe('computeGroupDragUpdates', () => {
  it('shifts every other selected visit by the dragged chip’s delta, preserving relative offsets', () => {
    const dragged = visit({ id: 'dragged', start: new Date(2024, 0, 1, 9, 0) })
    const other1 = visit({
      id: 'other-1',
      start: new Date(2024, 0, 1, 11, 0),
      end: new Date(2024, 0, 1, 11, 30),
    })
    const other2 = visit({
      id: 'other-2',
      start: new Date(2024, 0, 3, 13, 0), // 2 days later than the dragged chip
      end: new Date(2024, 0, 3, 14, 0),
    })
    const eventsById = new Map([
      [dragged.id, dragged],
      [other1.id, other1],
      [other2.id, other2],
    ])

    // Dragged chip moved +1 day, +2 hours (from 9:00 Jan 1 to 11:00 Jan 2).
    const newStart = new Date(2024, 0, 2, 11, 0)
    const updates = computeGroupDragUpdates(
      dragged.id,
      new Date(dragged.start),
      newStart,
      ['dragged', 'other-1', 'other-2'],
      eventsById,
      undefined
    )

    const byId = new Map(updates.map((u) => [u.visitId, u]))
    expect(byId.has('dragged')).toBe(false) // caller handles the dragged chip itself

    const u1 = byId.get('other-1')!
    expect(u1.startTime).toEqual(new Date(2024, 0, 2, 13, 0))
    expect(u1.endTime).toEqual(new Date(2024, 0, 2, 13, 30))

    const u2 = byId.get('other-2')!
    expect(u2.startTime).toEqual(new Date(2024, 0, 4, 15, 0))
    expect(u2.endTime).toEqual(new Date(2024, 0, 4, 16, 0))
  })

  it('omits assigneeUserId (untouched) when the caller passes undefined — no row change', () => {
    const dragged = visit({ id: 'dragged' })
    const other = visit({ id: 'other', assigneeUserId: 'worker-b', resourceId: 'worker-b' })
    const eventsById = new Map([
      [dragged.id, dragged],
      [other.id, other],
    ])

    const updates = computeGroupDragUpdates(
      'dragged',
      new Date(dragged.start),
      new Date(2024, 0, 1, 10, 0),
      ['dragged', 'other'],
      eventsById,
      undefined
    )

    expect(updates).toHaveLength(1)
    expect(updates[0]!.assigneeUserId).toBeUndefined()
    expect('assigneeUserId' in updates[0]!).toBe(true)
  })

  it('carries the resolved worker (including null for unassigned) to every other visit when the row changed', () => {
    const dragged = visit({ id: 'dragged' })
    const other = visit({ id: 'other' })
    const eventsById = new Map([
      [dragged.id, dragged],
      [other.id, other],
    ])

    const updates = computeGroupDragUpdates(
      'dragged',
      new Date(dragged.start),
      new Date(2024, 0, 1, 10, 0),
      ['dragged', 'other'],
      eventsById,
      null // dropped on the Unassigned column
    )

    expect(updates[0]!.assigneeUserId).toBeNull()
  })

  it('skips a selected id that has fallen out of the fetched events window', () => {
    const dragged = visit({ id: 'dragged' })
    const eventsById = new Map([[dragged.id, dragged]])

    const updates = computeGroupDragUpdates(
      'dragged',
      new Date(dragged.start),
      new Date(2024, 0, 1, 10, 0),
      ['dragged', 'missing'],
      eventsById,
      undefined
    )

    expect(updates).toEqual([])
  })

  it('returns an empty array when the group is just the dragged chip', () => {
    const dragged = visit({ id: 'dragged' })
    const eventsById = new Map([[dragged.id, dragged]])

    const updates = computeGroupDragUpdates(
      'dragged',
      new Date(dragged.start),
      new Date(2024, 0, 1, 10, 0),
      ['dragged'],
      eventsById,
      undefined
    )

    expect(updates).toEqual([])
  })
})
