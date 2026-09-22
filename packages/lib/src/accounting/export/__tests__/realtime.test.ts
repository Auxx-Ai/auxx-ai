// packages/lib/src/accounting/export/__tests__/realtime.test.ts
// The Outbox's live frames (plan 93 §3 B1/B2): which states a send and a rollback announce,
// that a dead transport never fails a send, and that a release's run id reaches the send.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const publish = vi.fn(async (..._args: unknown[]) => true)
const getRealtimeService = vi.fn(() => ({ publish }))
vi.mock('../../../realtime', async () => {
  const helpers = await import('../../../realtime/publish-helpers')
  return {
    getRealtimeService: () => getRealtimeService(),
    publishExportBatchChanged: helpers.publishExportBatchChanged,
  }
})

const resolveAccountingProvider = vi.fn()
vi.mock('../../providers/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../providers/provider')>()),
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
}))

const readExportBatchBlockers = vi.fn()
vi.mock('../preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../preflight')>()),
  readExportBatchBlockers: (...a: unknown[]) => readExportBatchBlockers(...a),
}))

const sendExportBatchStub = vi.fn()
vi.mock('../index', () => ({
  sendExportBatch: (...a: unknown[]) => sendExportBatchStub(...a),
}))

import { err, ok } from 'neverthrow'
import { exportBatchJob } from '../../../jobs/money/export-batch-job'
import { ProviderPostError } from '../../ledger/types'
import { rollbackExportBatch } from '../rollback'
import { sendExportBatch } from '../send'

const ORG = 'org_1'
const RUN = 'run_1'

function batch(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'batch_1',
    organizationId: ORG,
    bookId: 'book_1',
    connectionId: 'conn_1',
    objectType: 'journal',
    payload: { docNumber: 'FUL-20260914' },
    payloadHash: 'a'.repeat(64),
    state: 'ready',
    attempts: 0,
    totalMinor: 5000,
    providerObjectId: null,
    providerSyncToken: null,
    failureClass: null,
    lastError: null,
    ...over,
  }
}

/** `select()` hands back `row`; every `update().returning()` answers the row as that update left it. */
function sendDb(row: Record<string, unknown>): Database {
  let current = row
  const selectChain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit']) selectChain[method] = () => selectChain
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  selectChain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([row]).then(resolve)
  return {
    select: () => selectChain,
    update: () => {
      let values: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.set = (next: Record<string, unknown>) => {
        values = next
        return chain
      }
      chain.where = () => chain
      chain.returning = async () => {
        current = { ...current, ...values }
        return [current]
      }
      return chain
    },
  } as unknown as Database
}

function provider(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mock',
    capabilities: { withdrawRequiresVersion: false },
    sendObject: vi.fn(async () =>
      ok({ status: 'sent' as const, externalId: 'qbo_184', remoteVersion: '0', providerId: 'mock' })
    ),
    readObject: vi.fn(async () =>
      ok({
        status: 'found' as const,
        externalId: 'qbo_184',
        remoteVersion: '0',
        docNumber: 'FUL-20260914',
        totalMinor: null,
        payloadHash: null,
      })
    ),
    withdrawObject: vi.fn(async () =>
      ok({ status: 'withdrawn' as const, externalId: 'qbo_184', providerId: 'mock' })
    ),
    ...over,
  }
}

/** The `exportBatch:changed` payloads published, in order, after checking the room and event. */
function frames() {
  return publish.mock.calls.map(([room, event, data]) => {
    expect(room).toBe(`org-${ORG}`)
    expect(event).toBe('exportBatch:changed')
    return data as Record<string, unknown>
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getRealtimeService.mockImplementation(() => ({ publish }))
  publish.mockResolvedValue(true)
  readExportBatchBlockers.mockResolvedValue(ok(new Map()))
})

describe('sendExportBatch frames', () => {
  it('announces sending at the lease and sent at the settle, both tagged with the run', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())

    const result = await sendExportBatch(sendDb(batch()), {
      organizationId: ORG,
      batchId: 'batch_1',
      runId: RUN,
    })

    expect(result._unsafeUnwrap().status).toBe('sent')
    expect(frames()).toEqual([
      expect.objectContaining({ batchId: 'batch_1', state: 'sending', runId: RUN, attempts: 1 }),
      expect.objectContaining({
        batchId: 'batch_1',
        state: 'sent',
        runId: RUN,
        providerObjectId: 'qbo_184',
        failureClass: null,
        lastError: null,
      }),
    ])
  })

  it('announces failed with the refusal and its class', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        sendObject: vi.fn(async () =>
          err(new ProviderPostError('Closed period', { failureClass: 'data', providerId: 'mock' }))
        ),
      })
    )

    await sendExportBatch(sendDb(batch()), { organizationId: ORG, batchId: 'batch_1' })

    const [sending, failed] = frames()
    expect(sending).not.toHaveProperty('runId')
    expect(failed).toMatchObject({
      state: 'failed',
      failureClass: 'data',
      lastError: 'Closed period',
    })
  })

  it('announces ready when a send is not a fault and hands the batch back', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        sendObject: vi.fn(async () => ok({ status: 'not_connected' as const, providerId: 'mock' })),
      })
    )

    await sendExportBatch(sendDb(batch()), { organizationId: ORG, batchId: 'batch_1', runId: RUN })

    expect(frames().map((frame) => frame.state)).toEqual(['sending', 'ready'])
  })

  it('announces nothing when the lease is not won', async () => {
    const result = await sendExportBatch(sendDb(batch({ state: 'sent' })), {
      organizationId: ORG,
      batchId: 'batch_1',
    })

    expect(result._unsafeUnwrap().status).toBe('already_sent')
    expect(publish).not.toHaveBeenCalled()
  })

  it('still sends when the publish rejects', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    publish.mockRejectedValue(new Error('pusher down'))

    const result = await sendExportBatch(sendDb(batch()), {
      organizationId: ORG,
      batchId: 'batch_1',
    })

    expect(result._unsafeUnwrap().status).toBe('sent')
  })

  it('still sends when the realtime service cannot be built', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    getRealtimeService.mockImplementation(() => {
      throw new Error('no config')
    })

    const result = await sendExportBatch(sendDb(batch()), {
      organizationId: ORG,
      batchId: 'batch_1',
    })

    expect(result._unsafeUnwrap().status).toBe('sent')
  })
})

describe('rollbackExportBatch frames', () => {
  function rollbackDb(row: Record<string, unknown>): Database {
    const selectChain: Record<string, unknown> = {}
    for (const method of ['from', 'where', 'limit']) selectChain[method] = () => selectChain
    // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
    selectChain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([row]).then(resolve)
    const update = () => {
      const chain: Record<string, unknown> = {}
      chain.set = () => chain
      chain.where = () => chain
      chain.returning = async () => [{ id: 'ebp_1' }]
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
      return chain
    }
    return {
      select: () => selectChain,
      transaction: (fn: (tx: unknown) => unknown) => fn({ update }),
    } as unknown as Database
  }

  it('announces withdrawn once the provider copy is gone', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())

    const result = await rollbackExportBatch(
      rollbackDb(batch({ state: 'sent', providerObjectId: 'qbo_184', attempts: 1 })),
      { organizationId: ORG, batchId: 'batch_1' }
    )

    expect(result._unsafeUnwrap().status).toBe('withdrawn')
    expect(frames()).toEqual([
      expect.objectContaining({ batchId: 'batch_1', state: 'withdrawn', attempts: 1 }),
    ])
  })

  it('announces nothing on a refusal', async () => {
    await rollbackExportBatch(rollbackDb(batch({ state: 'sending' })), {
      organizationId: ORG,
      batchId: 'batch_1',
    })

    expect(publish).not.toHaveBeenCalled()
  })
})

describe('exportBatchJob', () => {
  it("threads the release's run id into the send", async () => {
    sendExportBatchStub.mockResolvedValue(ok({ batchId: 'batch_1', status: 'sent', attempts: 1 }))

    await exportBatchJob({ data: { organizationId: ORG, batchId: 'batch_1', runId: RUN } } as never)

    expect(sendExportBatchStub).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      batchId: 'batch_1',
      runId: RUN,
    })
  })
})
