// packages/lib/src/accounting/money/customer-money/__tests__/source-reads.test.ts
//
// The stub cannot evaluate SQL, so what is pinned is the PREDICATE each read
// hands the database, rendered through drizzle's own dialect. That is where
// `componentKey` (LIB-READS §0.1 bug 7) and the `(observedAt, id)` tie-break
// (§0.1 bug 4) actually travel.

import type { Database } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  currentObservationFilter,
  findSourceObjectByIdentity,
  readCurrentObservations,
  readSourceAccounts,
} from '../source-reads'

const ORG = 'org_1'
const dialect = new PgDialect()

interface Captured {
  where: SQL | undefined
}

/** A `Database` whose only select records the predicate and answers `rows`. */
function database(rows: unknown[], captured: Captured) {
  const chain = {
    from: () => chain,
    where: (where: SQL | undefined) => {
      captured.where = where
      return chain
    },
    limit: () => chain,
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
  }
  return { select: () => chain } as unknown as Database
}

const sqlOf = (captured: Captured) => dialect.sqlToQuery(captured.where!)

describe('findSourceObjectByIdentity', () => {
  it('asks for all five columns of the identity key, componentKey included', async () => {
    const captured: Captured = { where: undefined }
    await findSourceObjectByIdentity(database([], captured), ORG, {
      sourceAccountId: 'fsa_1',
      objectType: 'order_transaction',
      externalId: 'txn_1',
      componentKey: 'fee',
    })
    const { sql, params } = sqlOf(captured)
    expect(sql.match(/=/g)).toHaveLength(5)
    expect(params).toEqual([ORG, 'fsa_1', 'order_transaction', 'txn_1', 'fee'])
  })

  it('does not treat an empty componentKey as "no filter"', async () => {
    const captured: Captured = { where: undefined }
    await findSourceObjectByIdentity(database([], captured), ORG, {
      sourceAccountId: 'fsa_1',
      objectType: 'order_transaction',
      externalId: 'txn_1',
      componentKey: '',
    })
    expect(sqlOf(captured).params).toEqual([ORG, 'fsa_1', 'order_transaction', 'txn_1', ''])
  })
})

describe('readCurrentObservations', () => {
  it('breaks a tie on `observedAt` with the id, in one definition', async () => {
    const rendered = dialect.sqlToQuery(currentObservationFilter()).sql
    expect(rendered).toContain('NOT EXISTS')
    expect(rendered).toMatch(/"observedAt",\s*newer\."id"\)\s*>/)
  })

  it('keeps the newer of two observations stamped at the same instant', async () => {
    const observedAt = new Date('2026-09-15T01:00:00.000Z')
    const captured: Captured = { where: undefined }
    // The database applies `currentObservationFilter`; the stub answers with
    // the row that filter would have left standing.
    const db = database(
      [{ id: 'ob_2', sourceObjectId: 'fo_1', observedAt, contentHash: 'b' }],
      captured
    )
    const map = await readCurrentObservations(db, ORG, ['fo_1', 'fo_1'])
    expect(map.get('fo_1')?.id).toBe('ob_2')
    expect(sqlOf(captured).sql).toContain('NOT EXISTS')
    // Deduped: one id reaches the `in` list.
    expect(sqlOf(captured).params.slice(0, 2)).toEqual([ORG, 'fo_1'])
  })

  it('never queries for an empty id set', async () => {
    const captured: Captured = { where: undefined }
    expect((await readCurrentObservations(database([], captured), ORG, [])).size).toBe(0)
    expect(captured.where).toBeUndefined()
  })
})

describe('readSourceAccounts', () => {
  it('keys the batch by id', async () => {
    const captured: Captured = { where: undefined }
    const map = await readSourceAccounts(
      database([{ id: 'fsa_1' }, { id: 'fsa_2' }], captured),
      ORG,
      ['fsa_1', 'fsa_2']
    )
    expect([...map.keys()]).toEqual(['fsa_1', 'fsa_2'])
  })
})
