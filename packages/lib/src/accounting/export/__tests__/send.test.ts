// packages/lib/src/accounting/export/__tests__/send.test.ts
//
// The lease, the readback and the backoff, against a mock provider. What is
// exercised is what `sendExportBatch` WRITES back on the batch, so the fake db
// records every `update().set()` rather than re-implementing Postgres.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAccountingProvider = vi.fn()
vi.mock('../../providers/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../providers/provider')>()),
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
}))

import { err, ok } from 'neverthrow'
import { MAX_AUTO_ATTEMPTS, sendExportBatch } from '../send'

const ORG = 'org_1'

function batch(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'batch_1',
    organizationId: ORG,
    connectionId: 'conn_1',
    objectType: 'journal',
    payload: { docNumber: 'AUXX-FUL-20260914' },
    payloadHash: 'a'.repeat(64),
    state: 'ready',
    attempts: 0,
    totalMinor: 5000,
    ...over,
  }
}

/**
 * `select()` hands back `row`; `update()` records its `set()` and returns
 * `updates.length ? [row] : []` - which is how the lease and its later
 * ownership check are told apart.
 */
function fakeDb(row: unknown, options: { leaseLost?: boolean; leaseTaken?: boolean } = {}) {
  const sets: Array<Record<string, unknown>> = []
  const selectChain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit']) selectChain[method] = () => selectChain
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  selectChain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(row ? [row] : []).then(resolve)

  const db = {
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
        sets.push(values)
        // The first update is the lease; anything after it is the outcome.
        const isLease = sets.length === 1
        if (isLease && options.leaseTaken) return []
        if (!isLease && options.leaseLost) return []
        return [{ ...(row as Record<string, unknown>), ...values }]
      }
      return chain
    },
  } as unknown as Database
  return { db, sets }
}

const SENT = {
  status: 'sent' as const,
  externalId: 'qbo_184',
  remoteVersion: '0',
  providerId: 'quickbooks',
}

function provider(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mock',
    sendObject: vi.fn(async () => ok(SENT)),
    readObject: vi.fn(async () =>
      ok({
        status: 'found' as const,
        externalId: 'qbo_184',
        remoteVersion: '0',
        docNumber: 'AUXX-FUL-20260914',
        totalMinor: null,
        payloadHash: null,
      })
    ),
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('the lease', () => {
  it('takes it, sends, and records the provider object', async () => {
    const mock = provider()
    resolveAccountingProvider.mockResolvedValue(mock)
    const { db, sets } = fakeDb(batch())

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'sent', providerObjectId: 'qbo_184' })
    expect(sets[0]).toMatchObject({ state: 'sending', attempts: 1 })
    expect(sets[1]).toMatchObject({
      state: 'sent',
      providerObjectId: 'qbo_184',
      providerSyncToken: '0',
      leaseToken: null,
    })
  })

  it('keeps the idempotency key within the limit the provider declares', async () => {
    const mock = provider({ limits: { idempotencyKeyLength: 50 } })
    resolveAccountingProvider.mockResolvedValue(mock)
    const { db } = fakeDb(batch())

    await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    const sentWith = (i: number) =>
      (mock.sendObject.mock.calls[i] as unknown as [unknown, { idempotencyKey: string }])[1]
    expect(sentWith(0).idempotencyKey).toHaveLength(50)
    // The same batch derives the same key on a retry.
    await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })
    expect(sentWith(mock.sendObject.mock.calls.length - 1).idempotencyKey).toBe(
      sentWith(0).idempotencyKey
    )
  })

  it('answers leased_elsewhere rather than sending a second copy', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    const { db } = fakeDb(batch(), { leaseTaken: true })

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap().status).toBe('leased_elsewhere')
  })

  it('a sent batch is terminal: nothing is re-sent', async () => {
    const mock = provider()
    resolveAccountingProvider.mockResolvedValue(mock)
    const { db } = fakeDb(batch({ state: 'sent' }))

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap().status).toBe('already_sent')
    expect(mock.sendObject).not.toHaveBeenCalled()
  })

  it('a lost lease does not overwrite whoever holds it', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    const { db } = fakeDb(batch(), { leaseLost: true })

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap().status).toBe('leased_elsewhere')
  })

  it('refuses a batch that is not there', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    const { db } = fakeDb(null)

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'nope' })

    expect(result.isErr()).toBe(true)
  })
})

describe('the readback', () => {
  it('refuses a send the provider does not hold, rather than recording it', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        readObject: vi.fn(async () =>
          ok({
            status: 'gone' as const,
            externalId: null,
            remoteVersion: null,
            docNumber: null,
            totalMinor: null,
            payloadHash: null,
          })
        ),
      })
    )
    const { db, sets } = fakeDb(batch())

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap().status).toBe('failed')
    expect(sets[1]).toMatchObject({ state: 'failed' })
  })

  // Plan 67 §8a(a): the object EXISTS at the provider from the moment the create
  // returned. Dropping its id left it unwithdrawable and unnameable.
  it('records the provider object id even when the readback refuses', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        readObject: vi.fn(async () => err(new Error('QuickBooks timed out'))),
      })
    )
    const { db, sets } = fakeDb(batch())

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'failed',
      providerObjectId: 'qbo_184',
    })
    expect(sets[1]).toMatchObject({
      state: 'failed',
      providerObjectId: 'qbo_184',
      providerSyncToken: '0',
    })
  })

  it('records the provider object id when what the provider holds does not match', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        readObject: vi.fn(async () =>
          ok({
            status: 'found' as const,
            externalId: 'qbo_184',
            remoteVersion: '0',
            docNumber: 'AUXX-FUL-19990101',
            totalMinor: null,
            payloadHash: null,
          })
        ),
      })
    )
    const { db, sets } = fakeDb(batch())

    expect(
      (await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' }))._unsafeUnwrap()
    ).toMatchObject({ status: 'failed', providerObjectId: 'qbo_184' })
    expect(sets[1]).toMatchObject({ state: 'failed', providerObjectId: 'qbo_184' })
  })

  it('records nothing when the send itself never created anything', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({ sendObject: vi.fn(async () => err(new Error('QuickBooks said 2300'))) })
    )
    const { db, sets } = fakeDb(batch())

    expect(
      (await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' }))._unsafeUnwrap()
    ).not.toHaveProperty('providerObjectId')
    expect(sets[1]).not.toHaveProperty('providerObjectId')
  })

  it('compares by payloadHash when the provider can produce one', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        readObject: vi.fn(async () =>
          ok({
            status: 'found' as const,
            externalId: 'qbo_184',
            remoteVersion: '0',
            docNumber: 'AUXX-FUL-20260914',
            totalMinor: null,
            payloadHash: 'b'.repeat(64),
          })
        ),
      })
    )
    const { db, sets } = fakeDb(batch())

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap().status).toBe('failed')
    expect(String(sets[1]?.lastError)).toContain('does not match the payload')
  })

  // 🛑 `unsupported` is not a failure. A provider with no per-object read cannot
  // prove the send, and refusing afterwards would withdraw an object that is
  // correctly there. This is QuickBooks today - see `readObject`'s docblock.
  it('accepts a send the provider cannot read back', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        readObject: vi.fn(async () =>
          ok({
            status: 'unsupported' as const,
            externalId: null,
            remoteVersion: null,
            docNumber: null,
            totalMinor: null,
            payloadHash: null,
          })
        ),
      })
    )
    const { db, sets } = fakeDb(batch())

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap().status).toBe('sent')
    expect(sets[1]).toMatchObject({ state: 'sent' })
  })

  it("compares the provider's total with the payload's, not the postings' gross", async () => {
    // A payout deposit: gross 7714728 across the postings, 7518398 net to the bank.
    const netToBank = 7518398
    const readsBack = (totalMinor: number) =>
      provider({
        readObject: vi.fn(async () =>
          ok({
            status: 'found' as const,
            externalId: 'qbo_184',
            remoteVersion: '0',
            docNumber: 'AUXX-PAY-PAY0264',
            totalMinor,
            payloadHash: null,
          })
        ),
      })
    const deposit = () =>
      batch({
        totalMinor: 7714728,
        payload: { docNumber: 'AUXX-PAY-PAY0264', totalMinor: netToBank },
      })

    resolveAccountingProvider.mockResolvedValue(readsBack(netToBank))
    const accepted = await sendExportBatch(fakeDb(deposit()).db, {
      organizationId: ORG,
      batchId: 'batch_1',
    })
    expect(accepted._unsafeUnwrap()).toMatchObject({ status: 'sent' })

    resolveAccountingProvider.mockResolvedValue(readsBack(7714728))
    const refused = await sendExportBatch(fakeDb(deposit()).db, {
      organizationId: ORG,
      batchId: 'batch_1',
    })
    expect(refused._unsafeUnwrap()).toMatchObject({ status: 'failed' })
    expect(refused._unsafeUnwrap().error).toContain(`the ${netToBank} this batch sent`)
  })

  it('refuses when the document number the provider holds is not the one we sent', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        readObject: vi.fn(async () =>
          ok({
            status: 'found' as const,
            externalId: 'qbo_184',
            remoteVersion: '0',
            docNumber: 'SOMEONE-ELSES',
            totalMinor: null,
            payloadHash: null,
          })
        ),
      })
    )
    const { db } = fakeDb(batch())

    expect(
      (await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' }))._unsafeUnwrap()
    ).toMatchObject({ status: 'failed' })
  })
})

describe('failure and backoff', () => {
  it('records the provider refusal verbatim and schedules the next attempt', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({ sendObject: vi.fn(async () => err(new Error('QuickBooks said 6140'))) })
    )
    const { db, sets } = fakeDb(batch())

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'failed',
      error: 'QuickBooks said 6140',
    })
    expect(sets[1]).toMatchObject({ state: 'failed', lastError: 'QuickBooks said 6140' })
    expect(sets[1]?.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('backs off further on each attempt already spent', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({ sendObject: vi.fn(async () => err(new Error('rate limited'))) })
    )
    const first = fakeDb(batch({ attempts: 0 }))
    const later = fakeDb(batch({ attempts: 2 }))

    await sendExportBatch(first.db, { organizationId: ORG, batchId: 'batch_1' })
    await sendExportBatch(later.db, { organizationId: ORG, batchId: 'batch_1' })

    const firstDue = (first.sets[1]?.nextAttemptAt as Date).getTime()
    const laterDue = (later.sets[1]?.nextAttemptAt as Date).getTime()
    expect(laterDue).toBeGreaterThan(firstDue)
  })

  it('caps automatic attempts at three, which is what the sweep reads', () => {
    expect(MAX_AUTO_ATTEMPTS).toBe(3)
  })

  // 🛑 Not a fault, so it does not spend the budget: an org that switched
  // journal export off would otherwise need a person to press Retry.
  it('returns a disabled batch to ready without burning an attempt', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        sendObject: vi.fn(async () =>
          ok({ status: 'disabled', externalId: '', remoteVersion: null, providerId: 'quickbooks' })
        ),
      })
    )
    const { db, sets } = fakeDb(batch({ attempts: 0 }))

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'disabled', attempts: 0 })
    expect(sets[1]).toMatchObject({ state: 'ready', attempts: 0 })
  })

  // Plan 67 §5.2: a Payment waiting on its invoice is not a fault either.
  it('returns a waiting batch to ready without burning an attempt, recording why', async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        sendObject: vi.fn(async () =>
          ok({
            status: 'waiting',
            externalId: '',
            remoteVersion: null,
            providerId: 'quickbooks',
            waitingReason: 'Waiting for invoice AUXX-INV-1 to send',
          })
        ),
      })
    )
    const { db, sets } = fakeDb(batch({ attempts: 0 }))

    const result = await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap()).toMatchObject({ status: 'waiting', attempts: 0 })
    expect(sets[1]).toMatchObject({
      state: 'ready',
      attempts: 0,
      lastError: 'Waiting for invoice AUXX-INV-1 to send',
    })
  })

  it('a manual retry resets the budget a person has asserted is spent for a reason', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    const { db, sets } = fakeDb(batch({ state: 'failed', attempts: 3 }))

    await sendExportBatch(db, { organizationId: ORG, batchId: 'batch_1', manual: true })

    expect(sets[0]).toMatchObject({ attempts: 1 })
  })
})
