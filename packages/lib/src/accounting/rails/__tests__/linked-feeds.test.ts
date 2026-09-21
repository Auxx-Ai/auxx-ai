// packages/lib/src/accounting/rails/__tests__/linked-feeds.test.ts
//
// One `listLinkedFeeds` replaced three readers of the same question
// (LIB-READS §2.3). `@auxx/database` is stubbed in this suite, so the dialect
// prints no column names; the bound parameters are where the scope travels.

import type { Database } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { listLinkedFeeds } from '../reads'

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

const feed = (overrides: Record<string, unknown> = {}) => ({
  id: 'fsa_1',
  paymentGatewayId: 'pg_1',
  providerKey: 'shopify',
  externalAccountId: 'demo.myshopify.com',
  name: 'Demo',
  ...overrides,
})

describe('listLinkedFeeds', () => {
  it('asks only for live rows that name a rail', async () => {
    const captured: Captured = { where: undefined }
    await listLinkedFeeds(database([], captured), ORG)
    const { sql, params } = dialect.sqlToQuery(captured.where!)
    expect(sql).toContain('is not null')
    expect(sql).toContain('is null')
    expect(params).toEqual([ORG])
  })

  it('narrows to one provider', async () => {
    const captured: Captured = { where: undefined }
    await listLinkedFeeds(database([], captured), ORG, { providerKey: 'shopify' })
    expect(dialect.sqlToQuery(captured.where!).params).toEqual([ORG, 'shopify'])
  })

  it('narrows to a set of rails', async () => {
    const captured: Captured = { where: undefined }
    await listLinkedFeeds(database([], captured), ORG, {
      paymentGatewayIds: ['pg_1', 'pg_2', 'pg_1'],
    })
    expect(dialect.sqlToQuery(captured.where!).params).toEqual([ORG, 'pg_1', 'pg_2'])
  })

  it('never queries for an empty rail set', async () => {
    const captured: Captured = { where: undefined }
    expect(await listLinkedFeeds(database([], captured), ORG, { paymentGatewayIds: [] })).toEqual(
      []
    )
    expect(captured.where).toBeUndefined()
  })

  it('drops a row whose rail pointer came back null', async () => {
    const captured: Captured = { where: undefined }
    const rows = await listLinkedFeeds(
      database([feed(), feed({ id: 'fsa_2', paymentGatewayId: null })], captured),
      ORG
    )
    expect(rows.map((row) => row.id)).toEqual(['fsa_1'])
    expect(rows[0]!.paymentGatewayId).toBe('pg_1')
  })
})
