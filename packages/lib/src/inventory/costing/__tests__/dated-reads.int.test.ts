// packages/lib/src/inventory/costing/__tests__/dated-reads.int.test.ts
//
// `readPartNetThroughEach` (one grouped read for many days) against the per-day
// `readPartNetThrough` it replaces in the backflush walk (plans/mrp/11 §3), on real SQL: the
// createdAt fallback, excluded adjust_subparts rows, a movement exactly on a day's end, and
// book-zone days across both DST changes. Also times the full-history preview on a fixture.

import type { Database } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type BuildFixture, seedBuildOrg } from '../../builds/__tests__/support/build-fixture'
import { insertRawMovements, type RawMovement } from '../../builds/__tests__/support/raw-movements'
import { endOfLocalDay } from '../../builds/backfill-builds'
import {
  listBackflushDays,
  readBackflushGraph,
  walkBackflush,
} from '../../builds/backflush-planner'
import { previewBackflush } from '../../builds/backflush-preview'
import { readPartNetThrough, readPartNetThroughEach } from '../dated-reads'

vi.mock('../../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

const TZ = 'America/New_York'
const db = () => getTestDb() as unknown as Database

let f: BuildFixture

beforeEach(async () => {
  f = await seedBuildOrg({ components: 2 })
})

function dayList(from: string, to: string): string[] {
  const days: string[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; ) {
    days.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

async function expectEqualToPerDayReads(partIds: string[], days: string[]) {
  const throughs = days.map((day) => endOfLocalDay(day, TZ))
  const each = await readPartNetThroughEach(f.organizationId, partIds, throughs)
  const perDay = await Promise.all(
    throughs.map((through) => readPartNetThrough(f.organizationId, partIds, through))
  )
  expect(each.map((m) => Object.fromEntries(m))).toEqual(perDay.map((m) => Object.fromEntries(m)))
  return each
}

describe('readPartNetThroughEach', () => {
  it('equals one per-day read per day, edge rows included, across both DST changes', async () => {
    const [a, b] = f.componentPartIds as [string, string]
    const fg = f.producedPartId
    const end = (day: string) => endOfLocalDay(day, TZ)
    const plus = (date: Date, ms: number) => new Date(date.getTime() + ms)
    const rows: RawMovement[] = [
      // Opening history before the range.
      { partId: fg, quantity: 7, occurredAt: new Date('2025-12-01T12:00:00Z') },
      { partId: a, quantity: -3, occurredAt: new Date('2026-01-15T12:00:00Z') },
      // Exactly on a day's end counts that day; one millisecond later is the next day.
      { partId: fg, quantity: -2, occurredAt: end('2026-03-07') },
      { partId: fg, quantity: -5, occurredAt: plus(end('2026-03-07'), 1) },
      // The spring-forward day (23 hours) and the fall-back day (25 hours).
      { partId: b, quantity: -4, occurredAt: new Date('2026-03-08T06:30:00Z') },
      { partId: b, quantity: 9, occurredAt: plus(end('2026-11-01'), -1) },
      { partId: a, quantity: 1, occurredAt: new Date('2026-11-02T04:30:00Z') },
      // No occurred_at: dated by createdAt.
      { partId: a, quantity: -6, createdAt: new Date('2026-03-09T15:00:00Z') },
      // adjust_subparts rows are never in the ledger sum.
      {
        partId: fg,
        quantity: 100,
        occurredAt: new Date('2026-03-09T15:00:00Z'),
        adjustSubparts: true,
      },
      // After the last day: excluded.
      { partId: fg, quantity: -50, occurredAt: new Date('2026-11-10T12:00:00Z') },
    ]
    await insertRawMovements(f.organizationId, f.movementDefId, rows)

    const parts = [fg, a, b]
    const spring = await expectEqualToPerDayReads(parts, dayList('2026-03-06', '2026-03-10'))
    expect(spring[0]?.get(fg)).toBe(7)
    expect(spring[1]?.get(fg)).toBe(5) // the row on 03-07's end
    expect(spring[2]?.get(fg)).toBe(0) // the row 1 ms later
    expect(spring[3]?.get(a)).toBe(-9) // createdAt fallback
    await expectEqualToPerDayReads(parts, dayList('2026-10-30', '2026-11-03'))
  })

  it('reads zero for every part and day when nothing moved', async () => {
    const days = ['2026-01-01', '2026-01-02']
    const each = await expectEqualToPerDayReads([f.producedPartId], days)
    expect(each.map((m) => m.get(f.producedPartId))).toEqual([0, 0])
  })
})

describe('the full-history preview (plans/mrp/11 §6)', () => {
  it('walks ~1,900 days over ~20k movements in one request', async () => {
    const fg = f.producedPartId
    const [a, b] = f.componentPartIds as [string, string]
    const days = dayList('2021-07-16', '2026-09-24')
    const rows: RawMovement[] = []
    days.forEach((day, i) => {
      // Sales on the finished good most days, receipts on the components.
      for (let k = 0; k < 8; k += 1) {
        rows.push({ partId: fg, quantity: -1, occurredAt: new Date(`${day}T${10 + k}:00:00Z`) })
      }
      if (i % 3 === 0)
        rows.push({ partId: a, quantity: 30, occurredAt: new Date(`${day}T09:00:00Z`) })
      if (i % 5 === 0)
        rows.push({ partId: b, quantity: 50, occurredAt: new Date(`${day}T09:00:00Z`) })
    })
    await insertRawMovements(f.organizationId, f.movementDefId, rows)

    const now = new Date('2026-09-25T12:00:00Z')
    const started = performance.now()
    const preview = await previewBackflush(db(), f.organizationId, {
      from: '2021-07-16',
      to: '2026-09-24',
      now,
    })
    const previewMs = performance.now() - started
    if (preview.isErr()) throw preview.error
    expect(preview.value.days).toHaveLength(days.length)
    expect(preview.value.buildCount).toBe(days.length)
    expect(preview.value.unitCount).toBe(days.length * 8)

    // The per-day walk it replaces, on the first 60 days, extrapolated.
    const graph = await readBackflushGraph(db(), f.organizationId)
    const sample = listBackflushDays({ from: '2021-07-16', to: '2021-09-13' }, 'UTC', now)
    const perDayStarted = performance.now()
    await walkBackflush({
      organizationId: f.organizationId,
      graph,
      days: sample,
      carry: true,
      sliceDays: 1,
      act: async () => true,
      onDayError: () => {},
    })
    const perDayMs = ((performance.now() - perDayStarted) / sample.length) * days.length
    console.info(
      `[backflush preview] ${rows.length} movements, ${days.length} days: sliced ${Math.round(previewMs)} ms; per-day walk ≈ ${Math.round(perDayMs)} ms`
    )
    expect(previewMs).toBeLessThan(perDayMs)
  }, 300_000)
})
