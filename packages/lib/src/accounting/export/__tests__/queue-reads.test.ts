// packages/lib/src/accounting/export/__tests__/queue-reads.test.ts
//
// 89 D7, widened: the queue preflights `failed` rows as well as `ready` ones, so
// a stored refusal can be re-checked against the mapping table as it is read.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readExportBatchBlockers = vi.fn()
vi.mock('../preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../preflight')>()),
  readExportBatchBlockers: (...a: unknown[]) => readExportBatchBlockers(...a),
}))

import { ok } from 'neverthrow'
import { listExportBatches } from '../queue-reads'

const ORG = 'org_1'

const ITEM = {
  key: 'unmapped_account' as const,
  ref: 'gl_b',
  label: '5010 COGS - Direct Labor',
  remedy: 'Pick its account under Accounting > Settings > Accounts > Chart of accounts.',
}

function row(id: string, state: string) {
  return {
    id,
    bookId: 'book_1',
    state,
    mode: 'summary',
    avenue: 'manual',
    grainKey: '2026-09',
    storeId: null,
    railId: null,
    currency: 'USD',
    objectType: 'journal',
    totalMinor: 1000,
    payload: {},
    attempts: 1,
    lastError: null,
    failureClass: null,
    failureItems: [],
    providerObjectId: null,
    nextAttemptAt: null,
    sentAt: null,
    createdAt: new Date(),
  }
}

/** Resolves each awaited `select()` chain to the next canned result set. */
function fakeDb(results: unknown[][]): Database {
  let call = 0
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'orderBy', 'limit', 'offset', 'innerJoin', 'groupBy'])
    chain[key] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(results[call++] ?? []).then(resolve)
  return { select: () => chain } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  readExportBatchBlockers.mockResolvedValue(ok(new Map([['b2', [ITEM]]])))
})

describe('listExportBatches blockers', () => {
  it('preflights the failed rows as well as the ready ones, and carries the items', async () => {
    // The batch read selects `{ batch, dayKey }`, the member read is flat.
    const db = fakeDb([
      [row('b1', 'ready'), row('b2', 'failed'), row('b3', 'sent')].map((batch) => ({
        batch,
        dayKey: null,
      })),
      [],
    ])

    const result = await listExportBatches(db, { organizationId: ORG })

    expect(readExportBatchBlockers.mock.calls[0]?.[2].map((r: { id: string }) => r.id)).toEqual([
      'b1',
      'b2',
    ])
    const rows = result._unsafeUnwrap()
    expect(rows.find((batch) => batch.id === 'b2')?.blockers).toEqual([ITEM])
    expect(rows.find((batch) => batch.id === 'b1')?.blockers).toEqual([])
  })
})
