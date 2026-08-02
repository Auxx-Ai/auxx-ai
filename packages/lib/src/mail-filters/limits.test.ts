// packages/lib/src/mail-filters/limits.test.ts
// §5.2's counters. The two exclusions are the point: seeded (`templateKey`) rows
// are not the customer's allowance to spend, and personal-inbox filters are
// capped per user rather than against the org plan. Both are asserted on the
// QUERY the counter builds, so the test tracks the predicate and not its
// spelling.

import { describe, expect, it, vi } from 'vitest'
import { createChainableDatabaseMock } from '../test/database-mock'

// Partial mocks only (never a full replacement — the lib-test collection rule).
// Drizzle columns are `undefined` under vitest, so a nested Proxy hands out
// printable column tokens instead.
vi.mock('@auxx/database', () => ({
  database: createChainableDatabaseMock(),
  schema: new Proxy(
    {},
    {
      get: (_t, table) => new Proxy({}, { get: (_c, col) => `${String(table)}.${String(col)}` }),
    }
  ),
}))

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  eq: (col: unknown, value: unknown) => ({ eq: [col, value] }),
  ne: (col: unknown, value: unknown) => ({ ne: [col, value] }),
  isNull: (col: unknown) => ({ isNull: col }),
  count: () => ({ count: true }),
}))

import { countBillableMailFilters, countPersonalMailFilters } from './limits'

/** `select().from().innerJoin().innerJoin().where()` capturing the predicate. */
function fakeDb(value: number) {
  const captured: { where?: unknown; joins: number } = { joins: 0 }
  const chain = {
    from: () => chain,
    innerJoin: () => {
      captured.joins += 1
      return chain
    },
    where: async (cond: unknown) => {
      captured.where = cond
      return [{ value }]
    },
  }
  return { db: { select: () => chain } as never, captured }
}

describe('countBillableMailFilters', () => {
  it('excludes seeded (templateKey) rows', async () => {
    const { db, captured } = fakeDb(3)
    await countBillableMailFilters(db, 'org_1')

    expect(JSON.stringify(captured.where)).toContain('"isNull":"MailFilter.templateKey"')
  })

  it('excludes personal-inbox filters by DEFINITION, never by a flag or name', async () => {
    const { db, captured } = fakeDb(0)
    await countBillableMailFilters(db, 'org_1')

    const where = JSON.stringify(captured.where)
    expect(where).toContain('EntityDefinition.entityType')
    expect(where).toContain('personal_inbox')
    // Joined through the inbox instance to its definition — two hops.
    expect(captured.joins).toBe(2)
  })

  it('returns the counted value', async () => {
    const { db } = fakeDb(7)
    await expect(countBillableMailFilters(db, 'org_1')).resolves.toBe(7)
  })
})

describe('countPersonalMailFilters', () => {
  it('scopes to the author AND the personal definition, still excluding seeds', async () => {
    const { db, captured } = fakeDb(2)
    await expect(countPersonalMailFilters(db, 'org_1', 'usr_1')).resolves.toBe(2)

    const where = JSON.stringify(captured.where)
    expect(where).toContain('"eq":["MailFilter.createdByUserId","usr_1"]')
    expect(where).toContain('"eq":["EntityDefinition.entityType","personal_inbox"]')
    expect(where).toContain('"isNull":"MailFilter.templateKey"')
  })
})
