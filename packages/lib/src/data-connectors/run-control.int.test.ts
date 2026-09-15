// packages/lib/src/data-connectors/run-control.int.test.ts
import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateConnector } from './mutations'
import { completeRunStream, isRunPauseRequested } from './run-control'
import {
  claimForSync,
  clearResyncPending,
  finalizeConnector,
  initConnectorBackfillLatch,
  openRun,
  parkConnectorIfManuallyPaused,
} from './service'
import { createConnectorRunLedger } from './sync-core-adapters'

vi.mock('./data-connector-scheduler', () => ({
  syncConnectorScheduler: vi.fn(),
  removeConnectorScheduler: vi.fn(),
}))
const db = () => getTestDb() as unknown as Database
let orgId: string
let connectorId: string
let run: typeof schema.DataConnectorRun.$inferSelect
let streamIds: string[]

beforeEach(async () => {
  orgId = (await createTestOrganization()).id
  const [connector] = await db()
    .insert(schema.DataConnector)
    .values({
      organizationId: orgId,
      type: 'generic-rest',
      name: 'Pause fixture',
      status: 'syncing',
      resyncPending: {
        level: 'rebind',
        reasons: ['mapping-added'],
        streamIds: [],
        itemCount: 0,
        at: new Date().toISOString(),
      },
    })
    .returning()
  connectorId = connector!.id
  const streams = await db()
    .insert(schema.DataConnectorStream)
    .values(
      ['one', 'two'].map((streamKey) => ({
        organizationId: orgId,
        dataConnectorId: connectorId,
        streamKey,
        state: {
          phase: 'backfill' as const,
          backfillCursor: { kind: 'token' as const, value: 'page-2' },
          recordsSeen: 10,
        },
      }))
    )
    .returning()
  streamIds = streams.map((s) => s.id)
  run = await openRun(db(), {
    dataConnectorId: connectorId,
    organizationId: orgId,
    mode: 'snapshot',
    phase: 'backfill',
    trigger: 'manual',
    chainSnapshot: { streams: streamIds.map((streamId) => ({ streamId })) },
  })
  await initConnectorBackfillLatch(db(), connectorId, 2)
  await createConnectorRunLedger(db(), run, streamIds[0]).recordSlice({
    counters: { fetched: 10, created: 4 },
  })
})

const runRow = () =>
  db().query.DataConnectorRun.findFirst({ where: eq(schema.DataConnectorRun.id, run.id) })
const connectorRow = () =>
  db().query.DataConnector.findFirst({ where: eq(schema.DataConnector.id, connectorId) })
const pause = () => updateConnector(db(), orgId, connectorId, { status: 'paused' })
const stop = (streamId: string, beforePark = vi.fn(async () => {})) =>
  parkConnectorIfManuallyPaused(db(), {
    runId: run.id,
    streamId,
    dataConnectorId: connectorId,
    startedAt: run.startedAt,
    beforePark,
  })

describe('manual pause coordination', () => {
  it('blocks resume while slices drain, then preserves counts and cursor for a new run', async () => {
    await pause()
    expect(await isRunPauseRequested(db(), run.id)).toBe(true)
    expect((await runRow())!.status).toBe('running')
    expect(await claimForSync(db(), connectorId)).toBe(false)
    await updateConnector(db(), orgId, connectorId, { status: 'live' })
    expect(await claimForSync(db(), connectorId)).toBe(false)
    const finalize = vi.fn(async () => {
      expect((await runRow())!.progress).toMatchObject({
        finishedStreams: expect.arrayContaining(streamIds),
      })
    })
    await stop(streamIds[0]!, finalize)
    expect(finalize).not.toHaveBeenCalled()
    await stop(streamIds[1]!, finalize)
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(await runRow()).toMatchObject({ status: 'partial', fetched: 10, created: 4 })
    expect((await connectorRow())!.status).toBe('paused')
    const streams = await db().select().from(schema.DataConnectorStream)
    expect(
      streams.every(
        (s) => (s.state as { backfillCursor: { value: string } }).backfillCursor.value === 'page-2'
      )
    ).toBe(true)
    expect(await claimForSync(db(), connectorId)).toBe(false)
    expect(await claimForSync(db(), connectorId, true)).toBe(true)
    await initConnectorBackfillLatch(db(), connectorId, 2)
    expect(
      await completeRunStream(db(), connectorId, { runId: run.id, streamId: streamIds[0]! })
    ).toBeNull()
    expect((await connectorRow())!.state).toMatchObject({ backfillStreamsRemaining: 2 })
  })

  it('counts replayed stream completion once and publishes only after both siblings stop', async () => {
    await pause()
    const finalize = vi.fn(async () => {})
    await stop(streamIds[0]!, finalize)
    await stop(streamIds[0]!, finalize)
    expect((await connectorRow())!.state).toMatchObject({ backfillStreamsRemaining: 1 })
    await Promise.all(streamIds.map((id) => stop(id, finalize)))
    expect(finalize).toHaveBeenCalledTimes(1)
    await stop(streamIds[0]!, finalize)
    await stop(streamIds[1]!, finalize)
    expect(finalize).toHaveBeenCalledTimes(1)
  })

  it('includes a sibling that completed normally before the pause', async () => {
    expect(
      await completeRunStream(db(), connectorId, { runId: run.id, streamId: streamIds[0]! })
    ).toBe(1)
    await pause()
    const finalize = vi.fn(async () => {})
    await stop(streamIds[1]!, finalize)
    expect(finalize).toHaveBeenCalledTimes(1)
    expect((await runRow())!.status).toBe('partial')
  })

  it('does not let late success or failure clear a manual pause or its resync marker', async () => {
    await pause()
    await createConnectorRunLedger(db(), run).finalize()
    expect((await runRow())!.status).toBe('running')
    await finalizeConnector(db(), connectorId, { ok: true })
    await finalizeConnector(db(), connectorId, { ok: false, error: 'late failure' })
    await clearResyncPending(db(), connectorId)
    expect(await connectorRow()).toMatchObject({
      status: 'paused',
      resyncPending: { level: 'rebind' },
    })
    await updateConnector(db(), orgId, connectorId, { status: 'live' })
    await finalizeConnector(db(), connectorId, {
      ok: false,
      error: 'late failure after resume click',
    })
    await clearResyncPending(db(), connectorId)
    expect(await connectorRow()).toMatchObject({
      status: 'live',
      resyncPending: { level: 'rebind' },
    })
  })

  it('keeps a failed active slice draining during pause so siblings cannot overlap a resumed run', async () => {
    await pause()
    await createConnectorRunLedger(db(), run).fail(new Error('provider stopped'))
    expect((await runRow())!.status).toBe('running')
    expect(await claimForSync(db(), connectorId)).toBe(false)
    await stop(streamIds[0]!)
    await stop(streamIds[1]!)
    expect(await runRow()).toMatchObject({
      status: 'partial',
      errorSample: [expect.objectContaining({ error: 'provider stopped' })],
    })
  })
})
