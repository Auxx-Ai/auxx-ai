// packages/lib/src/mrp/__tests__/reads/plan-reads.int.test.ts
// The plan-table reads over seeded runs. Run: npx vitest run --config vitest.integration.config.ts src/mrp

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPlanItems } from '../../reads/list'
import { listRuns, resolveRun } from '../../reads/runs'
import { readSummary } from '../../reads/summary'
import { item } from '../support/plan-item'

vi.mock('../../../accounting/ledger/setup/book-time-zone', () => ({
  readBookTimeZoneOrUtc: vi.fn(async () => 'UTC'),
}))

// Labels come through the org cache; these tests seed no part records, so every label reads null.
vi.mock('../../../resources/system-records', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../resources/system-records')>()),
  systemFieldMap: vi.fn(async () => ({ part_sku: null, part_stock_status: null })),
}))

const db = () => getTestDb() as unknown as Database
const AS_OF = new Date('2026-09-24T06:00:00Z')

let organizationId: string

async function run(
  status: 'running' | 'completed' | 'failed',
  finishedAt: Date | null,
  id: string
) {
  await db()
    .insert(schema.MrpPlanRun)
    .values({
      id,
      organizationId,
      status,
      asOf: AS_OF,
      params: { aduWindowDays: 90 },
      startedAt: new Date(AS_OF.getTime() - 60_000),
      finishedAt,
      error: status === 'failed' ? 'boom' : null,
    })
}

async function items(runId: string, rows: Parameters<typeof item>[0][]) {
  await db()
    .insert(schema.MrpPlanRunItem)
    .values(rows.map((r) => ({ ...item(r), mrpPlanRunId: runId, organizationId })))
}

beforeEach(async () => {
  organizationId = (await createTestOrganization()).id
  await run('completed', new Date('2026-09-23T06:05:00Z'), 'old')
  await run('completed', new Date('2026-09-24T06:05:00Z'), 'new')
  await run('failed', null, 'bad')
  await items('old', [{ partId: 'p1' }])
  await items('new', [
    {
      partId: 'p1',
      isOverdue: true,
      orderByDate: '2026-09-20',
      priority: -1,
      suggestionKind: 'purchase',
      flags: ['no_lead_time'],
    },
    {
      partId: 'p2',
      orderByDate: '2026-09-28',
      priority: 0.2,
      suggestionKind: 'purchase',
      buffered: true,
    },
    {
      partId: 'p3',
      orderByDate: '2026-10-15',
      priority: 0.5,
      suggestionKind: 'build',
      supplyType: 'made',
    },
    { partId: 'p4' },
  ])
})

describe('resolveRun', () => {
  it('defaults to the latest completed run and refuses a failed or foreign one', async () => {
    expect((await resolveRun(db(), organizationId))._unsafeUnwrap()?.id).toBe('new')
    expect((await resolveRun(db(), organizationId, 'old'))._unsafeUnwrap()?.asOfDay).toBe(
      '2026-09-24'
    )
    expect((await resolveRun(db(), organizationId, 'bad'))._unsafeUnwrapErr().name).toBe(
      'NotFoundError'
    )
    const other = (await createTestOrganization()).id
    expect((await resolveRun(db(), other, 'new')).isErr()).toBe(true)
    expect((await resolveRun(db(), other))._unsafeUnwrap()).toBeNull()
  })
})

describe('listRuns', () => {
  it('lists every run newest first with its counts', async () => {
    const runs = (await listRuns(db(), organizationId))._unsafeUnwrap()
    const byId = new Map(runs.map((r) => [r.id, r]))
    expect(byId.get('new')).toMatchObject({
      itemCount: 4,
      overdueCount: 1,
      flaggedCount: 1,
      isLatest: true,
    })
    expect(byId.get('old')).toMatchObject({ itemCount: 1, isLatest: false })
    expect(byId.get('bad')).toMatchObject({ status: 'failed', error: 'boom', itemCount: 0 })
  })
})

describe('readSummary', () => {
  it('counts tabs and facets over the latest run', async () => {
    const { counts } = (await readSummary(db(), organizationId))._unsafeUnwrap()
    expect(counts).toMatchObject({
      total: 4,
      overdue: 1,
      thisWeek: 1,
      within30Days: 2,
      later: 1,
      flagged: 1,
      fine: 1,
      buffered: 1,
      unbuffered: 3,
      bySuggestionKind: { purchase: 2, build: 1 },
      bySupplyType: { bought: 3, made: 1, unclassified: 0 },
    })
    expect(counts?.byFlag.no_lead_time).toBe(1)
  })
})

describe('listPlanItems', () => {
  it('sorts by priority with nulls last and pages by offset', async () => {
    const first = (await listPlanItems(db(), organizationId, { limit: 2 }))._unsafeUnwrap()
    expect(first.items.map((i) => i.partId)).toEqual(['p1', 'p2'])
    expect(first.nextCursor).toBe(2)
    const second = (
      await listPlanItems(db(), organizationId, { limit: 2, cursor: first.nextCursor ?? 0 })
    )._unsafeUnwrap()
    expect(second.items.map((i) => i.partId)).toEqual(['p3', 'p4'])
    expect(second.nextCursor).toBeNull()
  })

  it('filters by tab and facets', async () => {
    const ids = async (input: Parameters<typeof listPlanItems>[2]) =>
      (await listPlanItems(db(), organizationId, input))._unsafeUnwrap().items.map((i) => i.partId)
    expect(await ids({ tab: 'this_week' })).toEqual(['p2'])
    expect(await ids({ tab: 'later' })).toEqual(['p3'])
    expect(await ids({ tab: 'fine' })).toEqual(['p4'])
    expect(await ids({ flags: ['no_lead_time'] })).toEqual(['p1'])
    expect(await ids({ suggestionKind: ['build'] })).toEqual(['p3'])
    expect(await ids({ buffered: true })).toEqual(['p2'])
    expect(await ids({ runId: 'old' })).toEqual(['p1'])
    expect(await ids({ sort: 'orderByDate', direction: 'desc' })).toEqual(['p3', 'p2', 'p1', 'p4'])
  })
})
