// packages/lib/src/postings/export/__tests__/rollback.test.ts
//
// Rollback is un-sync (TARGET §3): the provider's copy goes, the batch is
// `withdrawn`, and its postings are freed for the next build. Every refusal
// comes back as a RESULT with the reason on it, never as a throw.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAccountingProvider = vi.fn()
vi.mock('../../provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../provider')>()),
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
}))

import { err, ok } from 'neverthrow'
import { rollbackExportBatch } from '../rollback'

const ORG = 'org_1'

function batch(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'batch_1',
    organizationId: ORG,
    connectionId: 'conn_1',
    objectType: 'journal',
    state: 'sent',
    providerObjectId: 'qbo_184',
    providerSyncToken: '3',
    payload: {},
    ...over,
  }
}

function fakeDb(row: unknown) {
  const sets: Array<Record<string, unknown>> = []
  const selectChain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit']) selectChain[method] = () => selectChain
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  selectChain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(row ? [row] : []).then(resolve)

  const update = () => {
    let values: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.set = (next: Record<string, unknown>) => {
      values = next
      return chain
    }
    chain.where = () => chain
    chain.returning = async () => {
      sets.push(values)
      return [{ id: 'ebp_1' }, { id: 'ebp_2' }]
    }
    // The batch update is awaited without `.returning()`.
    // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
    chain.then = (resolve: (v: unknown) => unknown) => {
      sets.push(values)
      return Promise.resolve([]).then(resolve)
    }
    return chain
  }

  const db = {
    select: () => selectChain,
    transaction: (fn: (tx: unknown) => unknown) => fn({ update }),
  } as unknown as Database
  return { db, sets }
}

function provider(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mock',
    withdrawObject: vi.fn(async () =>
      ok({ status: 'withdrawn' as const, externalId: 'qbo_184', providerId: 'mock' })
    ),
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

it('withdraws the provider copy, marks the batch and frees its postings', async () => {
  const mock = provider()
  resolveAccountingProvider.mockResolvedValue(mock)
  const { db, sets } = fakeDb(batch())

  const result = await rollbackExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

  expect(result._unsafeUnwrap()).toMatchObject({ status: 'withdrawn', postingsFreed: 2 })
  expect(mock.withdrawObject).toHaveBeenCalledWith(
    { organizationId: ORG, connectionId: 'conn_1' },
    { objectType: 'journal', externalId: 'qbo_184', remoteVersion: '3' }
  )
  expect(sets[0]).toMatchObject({ state: 'withdrawn' })
  expect(sets[1]?.withdrawnAt).toBeInstanceOf(Date)
})

// 🛑 `already_gone` is a SUCCESS and it still frees the postings: convergence
// means "the provider no longer holds it", however it stopped holding it.
it('converges on a copy that is already gone', async () => {
  resolveAccountingProvider.mockResolvedValue(
    provider({
      withdrawObject: vi.fn(async () =>
        ok({ status: 'already_gone' as const, externalId: 'qbo_184', providerId: 'mock' })
      ),
    })
  )
  const { db } = fakeDb(batch())

  const result = await rollbackExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

  expect(result._unsafeUnwrap()).toMatchObject({ status: 'already_gone', postingsFreed: 2 })
})

it('a second rollback of a withdrawn batch is already_gone, not an error', async () => {
  resolveAccountingProvider.mockResolvedValue(provider())
  const { db } = fakeDb(batch({ state: 'withdrawn' }))

  expect(
    (await rollbackExportBatch(db, { organizationId: ORG, batchId: 'batch_1' }))._unsafeUnwrap()
  ).toMatchObject({ status: 'already_gone', postingsFreed: 0 })
})

describe('refusals come back as results, with the reason on them', () => {
  it("carries the provider's own sentence verbatim", async () => {
    resolveAccountingProvider.mockResolvedValue(
      provider({
        withdrawObject: vi.fn(async () => err(new Error('The period is closed in QuickBooks'))),
      })
    )
    const { db, sets } = fakeDb(batch())

    const result = await rollbackExportBatch(db, { organizationId: ORG, batchId: 'batch_1' })

    expect(result._unsafeUnwrap()).toMatchObject({
      status: 'refused',
      message: 'The period is closed in QuickBooks',
      postingsFreed: 0,
    })
    expect(sets).toEqual([])
  })

  it('refuses a batch that is being sent right now', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    const { db } = fakeDb(batch({ state: 'sending' }))

    expect(
      (await rollbackExportBatch(db, { organizationId: ORG, batchId: 'batch_1' }))._unsafeUnwrap()
    ).toMatchObject({ status: 'refused' })
  })

  it('refuses a batch that never reached the provider', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    const { db } = fakeDb(batch({ state: 'ready', providerObjectId: null }))

    expect(
      (await rollbackExportBatch(db, { organizationId: ORG, batchId: 'batch_1' }))._unsafeUnwrap()
    ).toMatchObject({ status: 'refused' })
  })

  // The one refusal `force` may override, and it is marked so the UI can offer it.
  it('refuses a missing version as FORCIBLE, and force gets past it', async () => {
    const mock = provider()
    resolveAccountingProvider.mockResolvedValue(mock)

    const held = fakeDb(batch({ providerSyncToken: null }))
    expect(
      (
        await rollbackExportBatch(held.db, { organizationId: ORG, batchId: 'batch_1' })
      )._unsafeUnwrap()
    ).toMatchObject({ status: 'refused', forcible: true })

    const forced = fakeDb(batch({ providerSyncToken: null }))
    expect(
      (
        await rollbackExportBatch(forced.db, {
          organizationId: ORG,
          batchId: 'batch_1',
          force: true,
        })
      )._unsafeUnwrap()
    ).toMatchObject({ status: 'withdrawn' })
  })

  it('refuses a batch that is not there', async () => {
    resolveAccountingProvider.mockResolvedValue(provider())
    const { db } = fakeDb(null)

    expect((await rollbackExportBatch(db, { organizationId: ORG, batchId: 'no' })).isErr()).toBe(
      true
    )
  })
})
