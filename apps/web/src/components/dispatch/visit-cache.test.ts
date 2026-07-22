// apps/web/src/components/dispatch/visit-cache.test.ts
//
// Unit coverage for the pure per-cache patch functions in `visit-cache.ts` (plan
// `dispatch/39-visit-cache-sync.md` §Phase-1) — no React Query, no QueryClient; just the
// window/merge/sort logic `applyVisitToCaches` wires into the cache.

import { describe, expect, it } from 'vitest'
import type { RouterOutputs } from '~/trpc/react'
import type { BoardResult, BoardVisit, BoardWorkOrder } from './ui/board/types'
import type { JobVisit } from './ui/job-schedule/use-job-visits'
import {
  applyBoardPatch,
  applyMyVisitsPatch,
  isScheduledWithinWindow,
  mergeJobVisits,
  patchBoardVisits,
  rewrapVisitDates,
  type SerializedVisitRow,
  sortByStartTimeAscNullsLast,
} from './visit-cache'

type MyVisitRow = RouterOutputs['dispatch']['myVisits'][number]

const WINDOW = { from: new Date('2026-07-20T00:00:00Z'), to: new Date('2026-07-27T00:00:00Z') }

function visit(overrides: Partial<BoardVisit> & { id: string }): BoardVisit {
  return {
    id: overrides.id,
    organizationId: 'org-1',
    workOrderId: overrides.workOrderId ?? 'wo-1',
    assigneeWorkerId: overrides.assigneeWorkerId ?? null,
    startTime: overrides.startTime ?? new Date('2026-07-21T09:00:00Z'),
    endTime: overrides.endTime ?? new Date('2026-07-21T10:00:00Z'),
    timezone: overrides.timezone ?? 'UTC',
    status: overrides.status ?? 'scheduled',
    routeOrder: overrides.routeOrder ?? null,
    latitude: overrides.latitude ?? null,
    longitude: overrides.longitude ?? null,
    geocodedAt: overrides.geocodedAt ?? null,
    dispatchedAt: overrides.dispatchedAt ?? null,
    timeConfirmedAt: overrides.timeConfirmedAt ?? null,
    durationMinutes: overrides.durationMinutes ?? 60,
    recurrenceRuleId: overrides.recurrenceRuleId ?? null,
    occurrenceDate: overrides.occurrenceDate ?? null,
    isDetached: overrides.isDetached ?? false,
    createdAt: overrides.createdAt ?? new Date('2026-07-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  } as BoardVisit
}

function workOrder(overrides: Partial<BoardWorkOrder> & { id: string }): BoardWorkOrder {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? 'Job',
    number: overrides.number ?? 'WO-1',
    status: overrides.status ?? 'scheduled',
    contactId: overrides.contactId ?? null,
    contactDisplayName: overrides.contactDisplayName ?? null,
  }
}

function jobVisit(overrides: Partial<JobVisit> & { id: string }): JobVisit {
  return {
    ...visit(overrides),
    invoiceState: overrides.invoiceState ?? 'uninvoiced',
    invoiceCount: overrides.invoiceCount ?? 0,
    invoiceId: overrides.invoiceId,
  } as JobVisit
}

function myVisit(overrides: Partial<MyVisitRow> & { id: string }): MyVisitRow {
  return {
    id: overrides.id,
    status: overrides.status ?? 'scheduled',
    startTime: overrides.startTime ?? new Date('2026-07-21T09:00:00Z'),
    endTime: overrides.endTime ?? new Date('2026-07-21T10:00:00Z'),
    timezone: overrides.timezone ?? 'UTC',
    workOrder: overrides.workOrder ?? { id: 'wo-1', displayName: 'Job', number: 'WO-1' },
  } as MyVisitRow
}

describe('isScheduledWithinWindow', () => {
  it('is false for an unscheduled (null startTime) visit', () => {
    expect(isScheduledWithinWindow(null, WINDOW)).toBe(false)
  })

  it('is true for a startTime inside the window', () => {
    expect(isScheduledWithinWindow(new Date('2026-07-21T09:00:00Z'), WINDOW)).toBe(true)
  })

  it('is false for a startTime outside the window', () => {
    expect(isScheduledWithinWindow(new Date('2026-08-01T09:00:00Z'), WINDOW)).toBe(false)
  })
})

describe('patchBoardVisits', () => {
  it('upserts an existing visit that is still in-window', () => {
    const v1 = visit({ id: 'v1', status: 'scheduled' })
    const patched = visit({ id: 'v1', status: 'en_route' })
    const next = patchBoardVisits([v1], patched, WINDOW)
    expect(next).toHaveLength(1)
    expect(next[0]?.status).toBe('en_route')
  })

  it('inserts a new in-window visit not previously cached', () => {
    const v1 = visit({ id: 'v1' })
    const created = visit({ id: 'v2' })
    const next = patchBoardVisits([v1], created, WINDOW)
    expect(next.map((v) => v.id).sort()).toEqual(['v1', 'v2'])
  })

  it('removes a visit that moved out of the window', () => {
    const v1 = visit({ id: 'v1', startTime: new Date('2026-07-21T09:00:00Z') })
    const moved = visit({ id: 'v1', startTime: new Date('2026-08-15T09:00:00Z') })
    const next = patchBoardVisits([v1], moved, WINDOW)
    expect(next).toHaveLength(0)
  })

  it('removes a visit that was unscheduled back to the backlog rail', () => {
    const v1 = visit({ id: 'v1', startTime: new Date('2026-07-21T09:00:00Z') })
    const unscheduled = visit({ id: 'v1', startTime: null, endTime: null })
    const next = patchBoardVisits([v1], unscheduled, WINDOW)
    expect(next).toHaveLength(0)
  })
})

describe('applyBoardPatch', () => {
  it('patches the matching workOrders[] entry status when workOrderStatus is given', () => {
    const board: BoardResult = {
      workers: [],
      visits: [visit({ id: 'v1', workOrderId: 'wo-1' })],
      workOrders: [workOrder({ id: 'wo-1', status: 'new' })],
    }
    const changed = visit({ id: 'v1', workOrderId: 'wo-1', status: 'en_route' })
    const { board: next, needsInvalidate } = applyBoardPatch(board, changed, 'in_progress', WINDOW)
    expect(needsInvalidate).toBe(false)
    expect(next.workOrders[0]?.status).toBe('in_progress')
    expect(next.visits[0]?.status).toBe('en_route')
  })

  it('flags needsInvalidate when the visit is in-window but its work order is unknown', () => {
    const board: BoardResult = { workers: [], visits: [], workOrders: [] }
    const created = visit({ id: 'v1', workOrderId: 'wo-never-seen' })
    const { needsInvalidate } = applyBoardPatch(board, created, undefined, WINDOW)
    expect(needsInvalidate).toBe(true)
  })

  it('never flags needsInvalidate for an out-of-window visit', () => {
    const board: BoardResult = { workers: [], visits: [], workOrders: [] }
    const outOfWindow = visit({ id: 'v1', startTime: new Date('2026-09-01T09:00:00Z') })
    const { needsInvalidate } = applyBoardPatch(board, outOfWindow, 'scheduled', WINDOW)
    expect(needsInvalidate).toBe(false)
  })
})

describe('mergeJobVisits', () => {
  it('preserves invoice enrichment fields on an update', () => {
    const existing = jobVisit({
      id: 'v1',
      status: 'scheduled',
      invoiceState: 'drafted',
      invoiceCount: 1,
      invoiceId: 'inv-1',
    })
    const changed = visit({ id: 'v1', status: 'done' })
    const [row] = mergeJobVisits([existing], changed)
    expect(row?.status).toBe('done')
    expect(row?.invoiceState).toBe('drafted')
    expect(row?.invoiceCount).toBe(1)
    expect(row?.invoiceId).toBe('inv-1')
  })

  it('inserts a new row at the enrichment zero-state', () => {
    const created = visit({ id: 'v2' })
    const [row] = mergeJobVisits([], created)
    expect(row?.invoiceState).toBe('uninvoiced')
    expect(row?.invoiceCount).toBe(0)
    expect(row?.invoiceId).toBeUndefined()
  })

  it('re-sorts ascending by startTime with unscheduled rows last', () => {
    const later = jobVisit({ id: 'later', startTime: new Date('2026-07-22T09:00:00Z') })
    const unscheduled = jobVisit({ id: 'unscheduled', startTime: null, endTime: null })
    const earlier = visit({ id: 'earlier', startTime: new Date('2026-07-21T09:00:00Z') })
    const next = mergeJobVisits([later, unscheduled], earlier)
    expect(next.map((r) => r.id)).toEqual(['earlier', 'later', 'unscheduled'])
  })
})

describe('applyMyVisitsPatch', () => {
  const viewerWorkerId = 'worker-1'
  const viewerWorkerIds = [viewerWorkerId]

  it('removes a row when the visit was reassigned away from the viewer', () => {
    const existing = myVisit({ id: 'v1' })
    const reassigned = visit({ id: 'v1', assigneeWorkerId: 'someone-else' })
    const { rows, needsInvalidate } = applyMyVisitsPatch(
      [existing],
      reassigned,
      viewerWorkerIds,
      WINDOW
    )
    expect(rows).toHaveLength(0)
    expect(needsInvalidate).toBe(false)
  })

  it('removes a row when the visit left the cached window', () => {
    const existing = myVisit({ id: 'v1' })
    const moved = visit({
      id: 'v1',
      assigneeWorkerId: viewerWorkerId,
      startTime: new Date('2026-09-01T09:00:00Z'),
    })
    const { rows } = applyMyVisitsPatch([existing], moved, viewerWorkerIds, WINDOW)
    expect(rows).toHaveLength(0)
  })

  it('removes a row when the visit was unscheduled', () => {
    const existing = myVisit({ id: 'v1' })
    const unscheduled = visit({
      id: 'v1',
      assigneeWorkerId: viewerWorkerId,
      startTime: null,
      endTime: null,
    })
    const { rows } = applyMyVisitsPatch([existing], unscheduled, viewerWorkerIds, WINDOW)
    expect(rows).toHaveLength(0)
  })

  it('updates in place while preserving the workOrder join', () => {
    const existing = myVisit({
      id: 'v1',
      status: 'scheduled',
      workOrder: { id: 'wo-1', displayName: 'Fix the sink', number: 'WO-42' },
    })
    const changed = visit({
      id: 'v1',
      assigneeWorkerId: viewerWorkerId,
      status: 'en_route',
      startTime: new Date('2026-07-22T11:00:00Z'),
      endTime: new Date('2026-07-22T12:00:00Z'),
    })
    const { rows, needsInvalidate } = applyMyVisitsPatch(
      [existing],
      changed,
      viewerWorkerIds,
      WINDOW
    )
    expect(needsInvalidate).toBe(false)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('en_route')
    expect(rows[0]?.startTime).toEqual(new Date('2026-07-22T11:00:00Z'))
    expect(rows[0]?.workOrder).toEqual({ id: 'wo-1', displayName: 'Fix the sink', number: 'WO-42' })
  })

  it('flags needsInvalidate when the visit should now appear but has no cached row', () => {
    const created = visit({ id: 'v1', assigneeWorkerId: viewerWorkerId })
    const { rows, needsInvalidate } = applyMyVisitsPatch([], created, viewerWorkerIds, WINDOW)
    expect(rows).toHaveLength(0)
    expect(needsInvalidate).toBe(true)
  })
})

describe('rewrapVisitDates', () => {
  it('round-trips every date field through JSON (the realtime wire shape) back to Date objects', () => {
    const row = visit({
      id: 'v1',
      startTime: new Date('2026-07-21T09:00:00.000Z'),
      endTime: new Date('2026-07-21T10:00:00.000Z'),
      geocodedAt: new Date('2026-07-20T00:00:00.000Z'),
      dispatchedAt: new Date('2026-07-21T08:00:00.000Z'),
      timeConfirmedAt: new Date('2026-07-19T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    })

    // `JSON.parse(JSON.stringify(...))` is exactly what the wire does to a `Date` (`toJSON`
    // serializes it to an ISO string) — the same transform a Pusher-protocol JSON payload puts
    // the row through, no SuperJSON involved.
    const wire = JSON.parse(JSON.stringify(row)) as SerializedVisitRow
    expect(typeof wire.startTime).toBe('string')
    expect(typeof wire.createdAt).toBe('string')

    const rewrapped = rewrapVisitDates(wire)
    expect(rewrapped).toEqual(row)
  })

  it('keeps null date fields null (never `new Date(null)`)', () => {
    const row = visit({
      id: 'v1',
      startTime: null,
      endTime: null,
      geocodedAt: null,
      dispatchedAt: null,
      timeConfirmedAt: null,
    })
    const wire = JSON.parse(JSON.stringify(row)) as SerializedVisitRow
    const rewrapped = rewrapVisitDates(wire)
    expect(rewrapped.startTime).toBeNull()
    expect(rewrapped.endTime).toBeNull()
    expect(rewrapped.geocodedAt).toBeNull()
    expect(rewrapped.dispatchedAt).toBeNull()
    expect(rewrapped.timeConfirmedAt).toBeNull()
  })
})

describe('sortByStartTimeAscNullsLast', () => {
  it('sorts ascending with nulls last', () => {
    const rows = [
      { id: 'b', startTime: null },
      { id: 'a', startTime: new Date('2026-07-21T09:00:00Z') },
      { id: 'c', startTime: new Date('2026-07-20T09:00:00Z') },
    ]
    expect(sortByStartTimeAscNullsLast(rows).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })
})
