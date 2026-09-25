// packages/lib/src/data-connectors/__tests__/reimport.int.test.ts
// v13 N5 against real SQL: the run-scoped cursor store and the re-import refusals.

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type BoundRecordFixture, seedBoundRecord, testDb } from '../__int-test-helpers'

const seams = vi.hoisted(() => ({
  catalogStreams: [] as { key: string; periodField?: string }[],
  accountingActive: false,
  cutoverStart: null as Date | null,
  enqueueConnectorSync: vi.fn(async () => {}),
}))

vi.mock('../connectors/app-connector-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../connectors/app-connector-adapter')>()),
  loadAppCatalogConnector: async () => ({ streams: seams.catalogStreams }),
}))
vi.mock('../../accounting/ledger/setup/cutover-start', () => ({
  readActiveCutoverStart: async () => (seams.accountingActive ? seams.cutoverStart : null),
}))
vi.mock('../data-connector-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data-connector-queue')>()),
  enqueueConnectorSync: seams.enqueueConnectorSync,
}))

import { requestReimport } from '../reimport'
import { isNewestSyncRun, openRun } from '../service'
import { createRunSyncStateStore } from '../sync-core-adapters'

let f: BoundRecordFixture
const CUTOVER = new Date('2026-07-01T07:00:00.000Z')
const STREAM_STATE = { phase: 'backfill' as const, recordsSeen: 3 }

async function makeApp() {
  await testDb()
    .update(schema.DataConnector)
    .set({ type: 'app:shop', definitionKind: 'app' })
    .where(eq(schema.DataConnector.id, f.connectorId))
}

async function completeBackfill(over: Partial<typeof schema.DataConnectorRun.$inferInsert> = {}) {
  await testDb()
    .insert(schema.DataConnectorRun)
    .values({
      dataConnectorId: f.connectorId,
      organizationId: f.orgId,
      trigger: 'manual',
      mode: 'snapshot',
      status: 'completed',
      phase: 'backfill',
      progress: { finishedStreams: [f.streamId] },
      ...over,
    })
}

const reimport = (recordFilter: { fieldId: string; operator: string; value?: unknown }[]) =>
  requestReimport(testDb(), {
    organizationId: f.orgId,
    connectorId: f.connectorId,
    streamIds: [f.streamId],
    recordFilter,
    initiatedBy: null,
  })

const august = (from = '2026-08-01T00:00:00Z') => ({
  fieldId: 'createdAt',
  operator: 'between',
  value: { from, to: '2026-09-01T00:00:00Z' },
})
const refresh = { fieldId: '$externalId', operator: 'in', value: ['5512'] }

beforeEach(async () => {
  f = await seedBoundRecord()
  await testDb()
    .update(schema.DataConnectorStream)
    .set({ state: STREAM_STATE })
    .where(eq(schema.DataConnectorStream.id, f.streamId))
  seams.catalogStreams = [{ key: 'product', periodField: 'createdAt' }]
  seams.accountingActive = false
  seams.cutoverStart = null
  seams.enqueueConnectorSync.mockClear()
})

describe('createRunSyncStateStore', () => {
  it('keeps each stream’s cursor on the run, never the watermark, and never the stream state', async () => {
    const run = await openRun(testDb(), {
      dataConnectorId: f.connectorId,
      organizationId: f.orgId,
      trigger: 'manual',
      mode: 'reimport',
      phase: 'backfill',
      progress: { checkpoints: { [f.streamId]: 'token:x' } },
    })
    const a = createRunSyncStateStore(testDb(), run.id, f.streamId)
    const b = createRunSyncStateStore(testDb(), run.id, 'other-stream')

    await a.save({
      phase: 'backfill',
      cursor: { kind: 'token', value: 'p2' },
      watermark: 'W',
      recordsSeen: 5,
    })
    await b.save({ phase: 'steady', recordsSeen: 9 })
    await a.save({ phase: 'backfill', cursor: { kind: 'token', value: 'p3' }, recordsSeen: 10 })

    expect(await a.load()).toEqual({
      phase: 'backfill',
      cursor: { kind: 'token', value: 'p3' },
      recordsSeen: 10,
      noProgressStrikes: 0,
    })
    expect(await b.load()).toMatchObject({ phase: 'steady', recordsSeen: 9, cursor: undefined })
    const [row] = await testDb()
      .select({ progress: schema.DataConnectorRun.progress })
      .from(schema.DataConnectorRun)
      .where(eq(schema.DataConnectorRun.id, run.id))
    expect(row?.progress).toMatchObject({ checkpoints: { [f.streamId]: 'token:x' } })
    expect(JSON.stringify(row?.progress)).not.toContain('"W"')

    const [stream] = await testDb()
      .select({ state: schema.DataConnectorStream.state })
      .from(schema.DataConnectorStream)
      .where(eq(schema.DataConnectorStream.id, f.streamId))
    expect(stream?.state).toEqual(STREAM_STATE)
  })
})

describe('requestReimport refusals (N5)', () => {
  it('refuses a generic REST connector', async () => {
    const result = await reimport([august()])
    expect(result._unsafeUnwrapErr().name).toBe('BadRequestError')
    expect(result._unsafeUnwrapErr().message).toMatch(/generic REST/)
  })

  it('refuses a stream this connector does not map', async () => {
    await makeApp()
    const result = await requestReimport(testDb(), {
      organizationId: f.orgId,
      connectorId: f.connectorId,
      streamIds: ['nope'],
      recordFilter: [august()],
    })
    expect(result._unsafeUnwrapErr().name).toBe('NotFoundError')
  })

  it('refuses a period run before the stream finished a backfill, but allows an id run', async () => {
    await makeApp()
    // A sample run marks its streams finished without completing them.
    await completeBackfill({ sampleLimit: 10, status: 'partial' })
    const period = await reimport([august()])
    expect(period._unsafeUnwrapErr().name).toBe('UnprocessableEntityError')
    expect(period._unsafeUnwrapErr().message).toContain('product')

    expect((await reimport([refresh]))._unsafeUnwrap()).toMatchObject({
      status: 'started',
      kind: 'id',
    })

    await completeBackfill()
    expect((await reimport([august()]))._unsafeUnwrap()).toMatchObject({ kind: 'period' })
  })

  it('enqueues with a unique job key, and only an id run retries its claim', async () => {
    await makeApp()
    await completeBackfill()
    await reimport([august()])
    await reimport([refresh])
    const calls = seams.enqueueConnectorSync.mock.calls as unknown as [
      { reimport: unknown; retryClaim?: true },
      { jobKey: string },
    ][]
    expect(calls.map(([data]) => data.retryClaim)).toEqual([undefined, true])
    expect(calls[0]?.[0].reimport).toMatchObject({ streamIds: [f.streamId] })
    expect(calls[0]?.[1].jobKey).toMatch(/^reimport-/)
    expect(calls[0]?.[1].jobKey).not.toBe(calls[1]?.[1].jobKey)
  })

  describe('an accounting-active org with a cutover', () => {
    beforeEach(async () => {
      await makeApp()
      await completeBackfill()
      seams.accountingActive = true
      seams.cutoverStart = CUTOVER
    })

    it('refuses a period run with no between on the periodField, or one starting before the cutover', async () => {
      const none = await reimport([{ fieldId: 'status', operator: 'is', value: 'paid' }])
      expect(none._unsafeUnwrapErr().name).toBe('UnprocessableEntityError')
      const early = await reimport([august('2026-06-01T00:00:00Z')])
      expect(early._unsafeUnwrapErr().message).toContain('createdAt between')
      expect((await reimport([august()])).isOk()).toBe(true)
    })

    it('ANDs the cutover into an id run as an exact clause', async () => {
      const result = (await reimport([refresh]))._unsafeUnwrap()
      expect(result.recordFilter).toEqual([
        { ...refresh, exact: true },
        {
          fieldId: 'createdAt',
          operator: 'between',
          value: { from: CUTOVER.toISOString() },
          exact: true,
        },
      ])
    })

    it('leaves a stream without a periodField alone', async () => {
      seams.catalogStreams = [{ key: 'product' }]
      const result = (await reimport([refresh]))._unsafeUnwrap()
      expect(result.recordFilter).toEqual([{ ...refresh, exact: true }])
    })
  })

  it('refuses a period run while a sync holds the connector, and queues an id run', async () => {
    await makeApp()
    await completeBackfill()
    await testDb()
      .update(schema.DataConnector)
      .set({ status: 'syncing' })
      .where(eq(schema.DataConnector.id, f.connectorId))

    const period = await reimport([august()])
    expect(period._unsafeUnwrapErr().name).toBe('ConflictError')
    expect((await reimport([refresh]))._unsafeUnwrap().status).toBe('queued')
    expect(seams.enqueueConnectorSync).toHaveBeenCalledTimes(1)
  })
})

describe('isNewestSyncRun', () => {
  it('ignores webhook runs and re-imports started after the parked run', async () => {
    const run = (trigger: string, mode: string, startedAt: string) =>
      openRun(testDb(), {
        dataConnectorId: f.connectorId,
        organizationId: f.orgId,
        trigger: trigger as 'manual',
        mode: mode as 'snapshot',
      }).then(async (r) => {
        await testDb()
          .update(schema.DataConnectorRun)
          .set({ startedAt: new Date(startedAt) })
          .where(eq(schema.DataConnectorRun.id, r.id))
        return r.id
      })
    const parked = await run('manual', 'snapshot', '2026-09-01T00:00:00Z')
    await run('webhook', 'incremental', '2026-09-02T00:00:00Z')
    await run('manual', 'reimport', '2026-09-03T00:00:00Z')
    expect(await isNewestSyncRun(testDb(), f.connectorId, parked)).toBe(true)

    await run('manual', 'snapshot', '2026-09-04T00:00:00Z')
    expect(await isNewestSyncRun(testDb(), f.connectorId, parked)).toBe(false)
  })
})
