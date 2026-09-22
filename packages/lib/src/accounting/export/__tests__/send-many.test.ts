// packages/lib/src/accounting/export/__tests__/send-many.test.ts
//
// A set leased in one UPDATE, cut where a payment's invoice has not sent, handed to
// `sendObjects` (or `sendObject` per row), and settled per row as `send.ts` settles.

import type { Database } from '@auxx/database'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const readLiveBatchMemberships = vi.fn()
vi.mock('../queue-reads', () => ({
  readLiveBatchMemberships: (...a: unknown[]) => readLiveBatchMemberships(...a),
}))

const frames: Array<{ batchId: string; state: string; runId?: string }> = []
vi.mock('../realtime', () => ({
  exportBatchFrame: (batch: { id: string; state: string }, runId?: string) => ({
    batchId: batch.id,
    state: batch.state,
    ...(runId ? { runId } : {}),
  }),
  publishExportBatchState: async (_org: string, frame: (typeof frames)[number]) => {
    frames.push(frame)
  },
}))

import { err, ok, type Result } from 'neverthrow'
import { ProviderPostError } from '../../ledger/types'
import type { SendObjectInput, SendObjectResult } from '../../providers/provider'
import { sendExportBatches } from '../send-many'

const ORG = 'org_1'
const dialect = new PgDialect()

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: ORG,
    connectionId: 'conn_1',
    objectType: 'journal',
    avenue: 'journal',
    payload: { docNumber: `DOC-${id}`, txnDate: '2026-09-01', totalMinor: 100 },
    payloadHash: 'a'.repeat(64),
    state: 'ready',
    attempts: 0,
    totalMinor: 100,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  }
}

/**
 * The lease is the one update whose `set` says `sending`; it answers the `leasable`
 * rows. Every later update names its row by id in the WHERE, read back off the SQL.
 */
function fakeDb(
  rows: Array<ReturnType<typeof row>>,
  options: { leasable?: string[]; dependencyStates?: Array<{ id: string; state: string }> } = {}
) {
  const leasable = new Set(options.leasable ?? rows.map((r) => r.id))
  const byId = new Map(rows.map((r) => [r.id, { ...r }]))
  const leases: Array<Record<string, unknown>> = []
  const settled: Array<{ id: string; values: Record<string, unknown> }> = []

  const db = {
    update: () => {
      let values: Record<string, unknown> = {}
      let where: unknown
      const chain: Record<string, unknown> = {}
      chain.set = (next: Record<string, unknown>) => {
        values = next
        return chain
      }
      chain.where = (next: unknown) => {
        where = next
        return chain
      }
      chain.returning = async () => {
        if (values.state === 'sending') {
          leases.push(values)
          return [...byId.values()]
            .filter((r) => leasable.has(r.id))
            .map((r) => ({ ...r, ...values, attempts: values.attempts === 1 ? 1 : r.attempts + 1 }))
        }
        const params = dialect.sqlToQuery(where as never).params
        const target = [...byId.values()].find((r) => params.includes(r.id))
        if (!target) return []
        settled.push({ id: target.id, values })
        return [{ ...target, ...values }]
      }
      return chain
    },
    select: () => {
      const chain: Record<string, unknown> = {}
      chain.from = () => chain
      chain.where = () => chain
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(options.dependencyStates ?? []).then(resolve)
      return chain
    },
  } as unknown as Database
  const stateOf = (id: string) => settled.filter((s) => s.id === id).at(-1)?.values
  return { db, leases, settled, stateOf }
}

type Answers = Result<Result<SendObjectResult, Error>[], Error>

const sentAnswer = (id: string): Result<SendObjectResult, Error> =>
  ok({
    status: 'sent' as const,
    externalId: `qbo_${id}`,
    remoteVersion: '0',
    providerId: 'mock',
    echo: { docNumber: `DOC-${id}`, totalMinor: 100, remoteVersion: '0' },
  })

/** A batch provider that answers every input `sent`, echoing what it was sent. */
function batchProvider() {
  const sendObjects = vi.fn(
    async (_ctx: unknown, inputs: SendObjectInput[]): Promise<Answers> =>
      ok(inputs.map((input) => sentAnswer((input.payload.docNumber as string).replace('DOC-', ''))))
  )
  return {
    id: 'mock',
    sendObject: vi.fn(),
    sendObjects,
    readObject: vi.fn(),
  }
}

const sentTypes = (sendObjects: ReturnType<typeof vi.fn>) =>
  sendObjects.mock.calls.map(([, inputs]) =>
    (inputs as Array<{ payload: { docNumber: string } }>).map((input) => input.payload.docNumber)
  )

beforeEach(() => {
  vi.clearAllMocks()
  frames.length = 0
  readExportBatchBlockers.mockResolvedValue(ok(new Map()))
  readLiveBatchMemberships.mockResolvedValue([])
})

describe('the set lease', () => {
  it('leases the free subset in one update and reports the rest', async () => {
    const provider = batchProvider()
    resolveAccountingProvider.mockResolvedValue(provider)
    const { db, leases, stateOf } = fakeDb([row('b1'), row('b2'), row('b3')], {
      leasable: ['b1', 'b2'],
    })

    const result = (
      await sendExportBatches(db, {
        organizationId: ORG,
        batchIds: ['b1', 'b2', 'b3'],
        runId: 'r1',
      })
    )._unsafeUnwrap()

    expect(leases).toHaveLength(1)
    expect(result.notLeased).toEqual(['b3'])
    expect(provider.sendObjects).toHaveBeenCalledTimes(1)
    expect(sentTypes(provider.sendObjects)).toEqual([['DOC-b1', 'DOC-b2']])
    expect(result.results.map((r) => [r.batchId, r.status])).toEqual([
      ['b1', 'sent'],
      ['b2', 'sent'],
    ])
    expect(stateOf('b1')).toMatchObject({ state: 'sent', providerObjectId: 'qbo_b1' })
    // The echo is the read-back: no per-row read.
    expect(provider.readObject).not.toHaveBeenCalled()
  })

  it('publishes each row as it leases and as it settles, tagged with the run', async () => {
    resolveAccountingProvider.mockResolvedValue(batchProvider())
    const { db } = fakeDb([row('b1'), row('b2')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'], runId: 'r1' })

    expect(frames).toEqual([
      { batchId: 'b1', state: 'sending', runId: 'r1' },
      { batchId: 'b2', state: 'sending', runId: 'r1' },
      { batchId: 'b1', state: 'sent', runId: 'r1' },
      { batchId: 'b2', state: 'sent', runId: 'r1' },
    ])
  })

  it('resets attempts on a Retry', async () => {
    resolveAccountingProvider.mockResolvedValue(batchProvider())
    const { db, leases } = fakeDb([row('b1', { state: 'failed', attempts: 3 })])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1'], manual: true })

    expect(leases[0]).toMatchObject({ state: 'sending', attempts: 1 })
  })

  it('answers an empty set without asking the provider', async () => {
    resolveAccountingProvider.mockResolvedValue(batchProvider())
    const { db } = fakeDb([row('b1')], { leasable: [] })

    const result = (
      await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1'] })
    )._unsafeUnwrap()

    expect(result).toEqual({ results: [], notLeased: ['b1'] })
  })
})

describe('the dependency rule', () => {
  const invoice = row('inv', {
    objectType: 'invoice',
    payload: { docNumber: 'DOC-inv', txnDate: '2026-09-01', totalMinor: 100 },
  })
  const payment = (txnDate: string) =>
    row('pay', {
      objectType: 'payment',
      payload: {
        docNumber: 'DOC-pay',
        txnDate,
        totalMinor: 100,
        appliesTo: { glPostingId: 'gp_inv' },
      },
    })
  const journal = row('jnl', {
    payload: { docNumber: 'DOC-jnl', txnDate: '2026-09-03', totalMinor: 100 },
  })

  it('cuts the set at a payment whose invoice has not sent, then sends it once the invoice has', async () => {
    const provider = batchProvider()
    resolveAccountingProvider.mockResolvedValue(provider)
    readLiveBatchMemberships.mockResolvedValue([{ batchId: 'inv', glPostingId: 'gp_inv' }])
    const { db } = fakeDb([journal, payment('2026-09-02'), invoice], {
      dependencyStates: [{ id: 'inv', state: 'ready' }],
    })

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['jnl', 'pay', 'inv'] })

    expect(sentTypes(provider.sendObjects)).toEqual([['DOC-inv'], ['DOC-pay', 'DOC-jnl']])
  })

  it('moves a payment dated before its invoice behind it', async () => {
    const provider = batchProvider()
    resolveAccountingProvider.mockResolvedValue(provider)
    readLiveBatchMemberships.mockResolvedValue([{ batchId: 'inv', glPostingId: 'gp_inv' }])
    const { db } = fakeDb([payment('2026-08-20'), invoice], {
      dependencyStates: [{ id: 'inv', state: 'ready' }],
    })

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['pay', 'inv'] })

    expect(sentTypes(provider.sendObjects)).toEqual([['DOC-inv'], ['DOC-pay']])
  })

  it('sends a payment whose invoice is elsewhere and unsent on its own, and returns it ready', async () => {
    const provider = batchProvider()
    provider.sendObjects.mockImplementation(async (_ctx, inputs) =>
      ok(
        inputs.map((input) =>
          input.objectType === 'payment'
            ? ok({
                status: 'waiting' as const,
                externalId: '',
                remoteVersion: null,
                providerId: 'mock',
                waitingReason: 'Waiting for invoice INV-9 to send',
              })
            : sentAnswer((input.payload.docNumber as string).replace('DOC-', ''))
        )
      )
    )
    resolveAccountingProvider.mockResolvedValue(provider)
    readLiveBatchMemberships.mockResolvedValue([{ batchId: 'elsewhere', glPostingId: 'gp_inv' }])
    const { db, stateOf } = fakeDb([payment('2026-09-01'), journal], {
      dependencyStates: [{ id: 'elsewhere', state: 'ready' }],
    })

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['pay', 'jnl'] })

    expect(sentTypes(provider.sendObjects)).toEqual([['DOC-pay'], ['DOC-jnl']])
    expect(stateOf('pay')).toMatchObject({
      state: 'ready',
      lastError: 'Waiting for invoice INV-9 to send',
    })
    expect(stateOf('jnl')).toMatchObject({ state: 'sent' })
  })

  it('keeps a payment whose invoice already sent in the same set', async () => {
    const provider = batchProvider()
    resolveAccountingProvider.mockResolvedValue(provider)
    readLiveBatchMemberships.mockResolvedValue([{ batchId: 'inv_old', glPostingId: 'gp_inv' }])
    const { db } = fakeDb([payment('2026-09-02'), journal], {
      dependencyStates: [{ id: 'inv_old', state: 'sent' }],
    })

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['pay', 'jnl'] })

    expect(sentTypes(provider.sendObjects)).toEqual([['DOC-pay', 'DOC-jnl']])
  })
})

describe('settling', () => {
  it('leaves each row on its own verdict when the call answered', async () => {
    const provider = batchProvider()
    provider.sendObjects.mockResolvedValue(
      ok([
        sentAnswer('b1'),
        err(
          new ProviderPostError('Business Validation Error', {
            failureClass: 'data',
            providerId: 'mock',
          })
        ),
      ])
    )
    resolveAccountingProvider.mockResolvedValue(provider)
    const { db, stateOf } = fakeDb([row('b1'), row('b2')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    expect(stateOf('b1')).toMatchObject({ state: 'sent' })
    expect(stateOf('b2')).toMatchObject({
      state: 'failed',
      failureClass: 'data',
      lastError: 'Business Validation Error',
      nextAttemptAt: null,
    })
  })

  it('fails every row as transport, with a backoff, when the whole call went unanswered', async () => {
    const provider = batchProvider()
    provider.sendObjects.mockResolvedValue(
      err(
        new ProviderPostError('socket hang up', { failureClass: 'transport', providerId: 'mock' })
      )
    )
    resolveAccountingProvider.mockResolvedValue(provider)
    const { db, stateOf } = fakeDb([row('b1'), row('b2')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    for (const id of ['b1', 'b2']) {
      expect(stateOf(id)).toMatchObject({ state: 'failed', failureClass: 'transport' })
      expect(stateOf(id)?.nextAttemptAt).toBeInstanceOf(Date)
    }
  })

  it('fails every row when sendObjects throws', async () => {
    const provider = batchProvider()
    provider.sendObjects.mockRejectedValue(new Error('Lambda timed out'))
    resolveAccountingProvider.mockResolvedValue(provider)
    const { db, stateOf } = fakeDb([row('b1'), row('b2')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    expect(stateOf('b1')).toMatchObject({ state: 'failed', lastError: 'Lambda timed out' })
    expect(stateOf('b2')).toMatchObject({ state: 'failed', lastError: 'Lambda timed out' })
  })

  it('reads a row back when its answer carries no echo', async () => {
    const provider = batchProvider()
    provider.sendObjects.mockResolvedValue(
      ok([
        ok({
          status: 'sent' as const,
          externalId: 'qbo_b1',
          remoteVersion: '0',
          providerId: 'mock',
        }),
      ])
    )
    provider.readObject.mockResolvedValue(
      ok({
        status: 'found',
        externalId: 'qbo_b1',
        remoteVersion: '1',
        docNumber: 'DOC-b1',
        totalMinor: 100,
        payloadHash: null,
      })
    )
    resolveAccountingProvider.mockResolvedValue(provider)
    const { db, stateOf } = fakeDb([row('b1')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1'] })

    expect(provider.readObject).toHaveBeenCalledTimes(1)
    expect(stateOf('b1')).toMatchObject({ state: 'sent', providerSyncToken: '1' })
  })

  it('refuses a blocked row before the provider, and sends the rest', async () => {
    const provider = batchProvider()
    resolveAccountingProvider.mockResolvedValue(provider)
    readExportBatchBlockers.mockResolvedValue(
      ok(
        new Map([
          [
            'b1',
            [{ key: 'unmapped_account', ref: 'gl_1', label: '4000 Sales', remedy: 'Map it.' }],
          ],
        ])
      )
    )
    const { db, stateOf } = fakeDb([row('b1'), row('b2')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    expect(stateOf('b1')).toMatchObject({ state: 'failed', failureClass: 'configuration' })
    expect(sentTypes(provider.sendObjects)).toEqual([['DOC-b2']])
  })

  it('falls back to sendObject per row when the provider has no sendObjects', async () => {
    const provider = {
      id: 'mock',
      sendObject: vi.fn(async (_ctx: unknown, input: { payload: { docNumber: string } }) =>
        sentAnswer((input.payload.docNumber as string).replace('DOC-', ''))
      ),
      readObject: vi.fn(),
    }
    resolveAccountingProvider.mockResolvedValue(provider)
    const { db, stateOf } = fakeDb([row('b1'), row('b2')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    expect(provider.sendObject).toHaveBeenCalledTimes(2)
    expect(stateOf('b1')).toMatchObject({ state: 'sent' })
    expect(stateOf('b2')).toMatchObject({ state: 'sent' })
  })

  it('sends with the same idempotency key the single path derives', async () => {
    const provider = batchProvider()
    resolveAccountingProvider.mockResolvedValue({
      ...provider,
      limits: { idempotencyKeyLength: 50 },
    })
    const { db } = fakeDb([row('b1')])

    await sendExportBatches(db, { organizationId: ORG, batchIds: ['b1'] })

    const inputs = provider.sendObjects.mock.calls[0]?.[1]
    const { hashExportPayload } = await import('../payloads/journal')
    expect(inputs?.[0]?.idempotencyKey).toBe(hashExportPayload(['b1', 'a'.repeat(64)]).slice(0, 50))
  })
})
