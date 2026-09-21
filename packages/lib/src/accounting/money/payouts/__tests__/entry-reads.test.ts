// packages/lib/src/accounting/money/payouts/__tests__/entry-reads.test.ts
//
// `listPayoutEntries` and the `payout_membership` window key, which four call
// sites used to retype as a template string (LIB-READS §2.3).

import type { Database } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { payoutMembershipWindowKey } from '../client'
import { listPayoutEntries } from '../entry-reads'

const ORG = 'org_1'
const dialect = new PgDialect()

interface Captured {
  where: SQL | undefined
}

function database(rows: unknown[], captured: Captured) {
  const chain = {
    from: () => chain,
    where: (where: SQL | undefined) => {
      captured.where = where
      return chain
    },
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
  }
  return { select: () => chain } as unknown as Database
}

describe('payoutMembershipWindowKey', () => {
  it('is the key the coverage rows are stored under', () => {
    expect(payoutMembershipWindowKey('po_1', 'acq_1')).toBe('payout:po_1:acquisition:acq_1')
  })
})

describe('listPayoutEntries', () => {
  it('excludes the outgoing-transfer item by default', async () => {
    const captured: Captured = { where: undefined }
    await listPayoutEntries(database([], captured), ORG, [
      { sourceAccountId: 'fsa_1', payoutExternalId: 'po_1' },
    ])
    expect(dialect.sqlToQuery(captured.where!).params).toEqual([ORG, false, 'fsa_1', 'po_1'])
  })

  it('asks for every item when the payout itself is wanted', async () => {
    const captured: Captured = { where: undefined }
    await listPayoutEntries(
      database([], captured),
      ORG,
      [{ sourceAccountId: 'fsa_1', payoutExternalId: 'po_1' }],
      { includeOutgoing: true }
    )
    expect(dialect.sqlToQuery(captured.where!).params).toEqual([ORG, 'fsa_1', 'po_1'])
  })

  it('ORs the scopes pairwise rather than crossing the two id lists', async () => {
    const captured: Captured = { where: undefined }
    await listPayoutEntries(database([], captured), ORG, [
      { sourceAccountId: 'fsa_1', payoutExternalId: 'po_1' },
      { sourceAccountId: 'fsa_2', payoutExternalId: 'po_2' },
    ])
    const { sql, params } = dialect.sqlToQuery(captured.where!)
    expect(sql).toContain(' or ')
    expect(params).toEqual([ORG, false, 'fsa_1', 'po_1', 'fsa_2', 'po_2'])
  })

  it('never queries for an empty scope list', async () => {
    const captured: Captured = { where: undefined }
    expect(await listPayoutEntries(database([], captured), ORG, [])).toEqual([])
    expect(captured.where).toBeUndefined()
  })
})
