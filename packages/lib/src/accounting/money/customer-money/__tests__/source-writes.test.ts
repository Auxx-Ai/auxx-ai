// packages/lib/src/accounting/money/customer-money/__tests__/source-writes.test.ts
//
// The one coverage predicate (LIB-READS §0.1 bug 3). The two doors used to
// disagree: one counted acceptances by `orderExternalId`, the other by
// `orderInstanceId`, so `complete` flipped depending on which sweep ran last.

import type { Database } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { countOrderAcceptanceStates, refreshOrderCoverageCounts } from '../source-writes'

const ORG = 'org_1'
const dialect = new PgDialect()

interface Captured {
  where: SQL | undefined
  executed: SQL | undefined
}

function database(rows: unknown[], captured: Captured) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: (where: SQL | undefined) => {
      captured.where = where
      return chain
    },
    groupBy: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
  }
  return {
    select: () => chain,
    execute: vi.fn(async (statement: SQL) => {
      captured.executed = statement
    }),
  } as unknown as Database
}

describe('countOrderAcceptanceStates', () => {
  it('narrows on the org, the resolved order and the object’s source account', async () => {
    const captured: Captured = { where: undefined, executed: undefined }
    await countOrderAcceptanceStates(database([], captured), ORG, {
      orderInstanceIds: ['order_1'],
      sourceAccountId: 'fsa_1',
    })
    // `@auxx/database` is stubbed in this suite, so the dialect prints no
    // column names; the bound parameters are where the scope travels.
    const { sql, params } = dialect.sqlToQuery(captured.where!)
    expect(sql).toMatch(/= \$1 and .* in \(\$2\) and .* = \$3/)
    expect(params).toEqual([ORG, 'order_1', 'fsa_1'])
  })

  it('drops an acceptance that has no resolved order — it is not coverage of any order', async () => {
    const captured: Captured = { where: undefined, executed: undefined }
    const rows = [
      {
        sourceAccountId: 'fsa_1',
        orderInstanceId: null,
        fetchedCount: 1,
        acceptedCount: 0,
        rejectedCount: 0,
      },
      {
        sourceAccountId: 'fsa_1',
        orderInstanceId: 'order_1',
        fetchedCount: 3,
        acceptedCount: 1,
        rejectedCount: 1,
      },
    ]
    const counts = await countOrderAcceptanceStates(database(rows, captured), ORG, {
      orderInstanceIds: ['order_1'],
    })
    expect(counts).toEqual([
      {
        sourceAccountId: 'fsa_1',
        orderInstanceId: 'order_1',
        fetchedCount: 3,
        acceptedCount: 1,
        rejectedCount: 1,
        pendingCount: 1,
      },
    ])
  })
})

describe('refreshOrderCoverageCounts', () => {
  it('writes the tally onto the order_transactions window and re-derives `complete`', async () => {
    const captured: Captured = { where: undefined, executed: undefined }
    const db = database(
      [
        {
          sourceAccountId: 'fsa_1',
          orderInstanceId: 'order_1',
          fetchedCount: 2,
          acceptedCount: 2,
          rejectedCount: 0,
        },
      ],
      captured
    )
    await refreshOrderCoverageCounts(db, ORG, {
      sourceAccountId: 'fsa_1',
      orderInstanceId: 'order_1',
    })
    const { sql, params } = dialect.sqlToQuery(captured.executed!)
    expect(sql).toContain('UPDATE "FinancialSourceCoverage"')
    expect(sql).toContain(`"streamKey"='order_transactions'`)
    expect(sql).toContain('sourceComplete')
    expect(params).toEqual(['order_1', 'fsa_1', 2, 2, 0, 0, ORG])
  })

  it('issues no statement when the order has no acceptances at all', async () => {
    const captured: Captured = { where: undefined, executed: undefined }
    const db = database([], captured)
    await refreshOrderCoverageCounts(db, ORG, {
      sourceAccountId: 'fsa_1',
      orderInstanceId: 'order_1',
    })
    expect(captured.executed).toBeUndefined()
  })
})
