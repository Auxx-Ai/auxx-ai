// packages/lib/src/mrp/__tests__/write-run.int.test.ts

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { completeRun, failRun, failStaleRuns, pruneRuns, startRun } from '../run/write-run'
import type { PlanItem } from '../types'

const db = () => getTestDb() as unknown as Database
let orgId: string

function item(partId: string): PlanItem {
  return {
    partId,
    supplyType: 'bought',
    buffered: false,
    proposedBuffered: false,
    proposalReasons: ['no_usage'],
    adu: null,
    sigma: null,
    cv: null,
    stockoutDaysExcluded: 0,
    onHand: 0,
    onOrder: 0,
    openDemand: 0,
    netFlow: 0,
    leadTimeDays: null,
    leadTimeSource: 'none',
    decoupledLeadTimeDays: null,
    observedLeadTimeDays: null,
    observedReceipts: null,
    leadTimeFactor: null,
    leadTimeFactorSource: null,
    variabilityFactor: 0.5,
    variabilityFactorSource: 'default',
    orderCycleDays: null,
    orderMode: 'when_needed',
    nextOrderDate: null,
    nextArrivalDate: null,
    followingArrivalDate: null,
    pullsOrderForward: null,
    seasonalIndex: null,
    baseAdu: null,
    topOfRed: null,
    topOfYellow: null,
    topOfGreen: null,
    stockoutDate: null,
    orderByDate: '2026-09-20',
    priority: null,
    suggestionKind: null,
    suggestedQty: null,
    suggestedPurchaseUnits: null,
    suggestedVendorPartId: null,
    suggestedSupplierId: null,
    flags: ['no_lead_time'],
    isOverdue: true,
  }
}

async function completedRun(asOf: string, items: PlanItem[]): Promise<string> {
  const runId = (
    await startRun(db(), orgId, { asOf, params: {}, trigger: 'nightly' })
  )._unsafeUnwrap()
  ;(await completeRun(db(), runId, items))._unsafeUnwrap()
  return runId
}

async function latestItemRunIds(): Promise<string[]> {
  const rows = await db()
    .select({ runId: schema.MrpPlanRunItem.mrpPlanRunId })
    .from(schema.MrpPlanRunItem)
    .where(
      and(eq(schema.MrpPlanRunItem.organizationId, orgId), eq(schema.MrpPlanRunItem.isLatest, true))
    )
  return [...new Set(rows.map((r) => r.runId))]
}

beforeEach(async () => {
  orgId = (await createTestOrganization()).id
})

describe('write-run', () => {
  it('moves isLatest to the new run and marks it completed', async () => {
    const first = await completedRun('2026-09-23', [item('a'), item('b')])
    expect(await latestItemRunIds()).toEqual([first])

    const second = await completedRun('2026-09-24', [item('a')])
    expect(await latestItemRunIds()).toEqual([second])

    const [run] = await db()
      .select()
      .from(schema.MrpPlanRun)
      .where(eq(schema.MrpPlanRun.id, second))
    expect(run?.status).toBe('completed')
    expect(run?.finishedAt).not.toBeNull()
    const [row] = await db()
      .select()
      .from(schema.MrpPlanRunItem)
      .where(eq(schema.MrpPlanRunItem.mrpPlanRunId, second))
    expect(row).toMatchObject({ organizationId: orgId, isOverdue: true, flags: ['no_lead_time'] })
    expect(row?.runAsOf.toISOString()).toBe('2026-09-24T12:00:00.000Z')
  })

  it('writes more than one chunk of 500 items', async () => {
    const items = Array.from({ length: 1203 }, (_, i) => item(`p${i}`))
    const runId = await completedRun('2026-09-24', items)
    const rows = await db()
      .select({ partId: schema.MrpPlanRunItem.partId })
      .from(schema.MrpPlanRunItem)
      .where(eq(schema.MrpPlanRunItem.mrpPlanRunId, runId))
    expect(rows).toHaveLength(1203)
  })

  it('failRun records the error and leaves the latest items alone', async () => {
    const good = await completedRun('2026-09-23', [item('a')])
    const runId = (
      await startRun(db(), orgId, { asOf: '2026-09-24', params: {}, trigger: 'manual' })
    )._unsafeUnwrap()
    await failRun(db(), runId, new Error('mirror unavailable'))

    const [run] = await db().select().from(schema.MrpPlanRun).where(eq(schema.MrpPlanRun.id, runId))
    expect(run).toMatchObject({ status: 'failed', error: 'mirror unavailable' })
    expect(await latestItemRunIds()).toEqual([good])
  })

  it('failStaleRuns fails only running runs past the age limit', async () => {
    const start = (asOf: string) =>
      startRun(db(), orgId, { asOf, params: {}, trigger: 'nightly' }).then((r) => r._unsafeUnwrap())
    const orphan = await start('2026-09-22')
    const fresh = await start('2026-09-23')
    await db()
      .update(schema.MrpPlanRun)
      .set({ startedAt: new Date(Date.now() - 7 * 3_600_000) })
      .where(eq(schema.MrpPlanRun.id, orphan))

    expect((await failStaleRuns(db(), orgId, 6 * 3_600_000))._unsafeUnwrap()).toEqual({ failed: 1 })
    const rows = await db()
      .select({
        id: schema.MrpPlanRun.id,
        status: schema.MrpPlanRun.status,
        error: schema.MrpPlanRun.error,
      })
      .from(schema.MrpPlanRun)
      .where(eq(schema.MrpPlanRun.organizationId, orgId))
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(orphan)).toMatchObject({
      status: 'failed',
      error: 'orphaned: worker did not finish',
    })
    expect(byId.get(fresh)?.status).toBe('running')
  })

  it('prune deletes old runs and their items but keeps the latest completed one', async () => {
    const old = await completedRun('2026-01-01', [item('a')])
    const latest = await completedRun('2026-01-02', [item('a')])
    const failed = (
      await startRun(db(), orgId, { asOf: '2026-01-03', params: {}, trigger: 'manual' })
    )._unsafeUnwrap()
    await failRun(db(), failed, new Error('x'))
    const longAgo = new Date(Date.now() - 200 * 86_400_000)
    await db()
      .update(schema.MrpPlanRun)
      .set({ startedAt: longAgo })
      .where(eq(schema.MrpPlanRun.organizationId, orgId))

    expect((await pruneRuns(db(), orgId, 90))._unsafeUnwrap()).toEqual({ deleted: 2 })
    const runs = await db()
      .select({ id: schema.MrpPlanRun.id })
      .from(schema.MrpPlanRun)
      .where(eq(schema.MrpPlanRun.organizationId, orgId))
    expect(runs.map((r) => r.id)).toEqual([latest])
    const oldItems = await db()
      .select()
      .from(schema.MrpPlanRunItem)
      .where(eq(schema.MrpPlanRunItem.mrpPlanRunId, old))
    expect(oldItems).toHaveLength(0)
  })
})
