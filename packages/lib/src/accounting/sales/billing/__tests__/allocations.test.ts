// packages/lib/src/accounting/sales/billing/__tests__/allocations.test.ts
//
// These readers exist because four copies of the same query disagreed on two
// predicates: whether `kind='base'` is applied, and whether `organizationId` is.
// Both are invisible in a row-shape assertion, so what is pinned here is the
// compiled SQL — the only witness that survives a refactor of the return value.

import type { Database } from '@auxx/database'
import { getTableName, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  listInstallments,
  listVisitAllocationsForVisits,
  listWorkOrderAllocations,
  listWorkOrderVisitAllocations,
  releaseLineAllocations,
} from '../allocations'

const ORG = 'org_1'
const dialect = new PgDialect()

/** Bound parameters of a compiled predicate — the column names render empty out of
 * query-builder context, so the parameter list is what the predicate is pinned by. */
function params(where: SQL | undefined): unknown[] {
  return where ? dialect.sqlToQuery(where).params : []
}

interface Capture {
  findMany: { table: string; where: SQL | undefined; orderBy?: unknown }[]
  findFirst: { table: string; where: SQL | undefined }[]
  updates: { table: string; set: Record<string, unknown>; where: SQL | undefined }[]
}

function stubDb(): { db: Database; captured: Capture } {
  const captured: Capture = { findMany: [], findFirst: [], updates: [] }
  const tables = [
    'InvoiceLineAllocation',
    'InvoiceVisitAllocation',
    'InvoiceScheduleAllocation',
    'WorkOrderBillingInstallment',
  ]
  const query: Record<string, unknown> = {}
  for (const table of tables) {
    query[table] = {
      findMany: async (args: { where: SQL | undefined; orderBy?: unknown }) => {
        captured.findMany.push({ table, ...args })
        return []
      },
      findFirst: async (args: { where: SQL | undefined }) => {
        captured.findFirst.push({ table, ...args })
        return undefined
      },
    }
  }
  const db = {
    query,
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: SQL | undefined) => {
          captured.updates.push({ table: getTableName(table), set, where })
        },
      }),
    }),
  } as unknown as Database
  return { db, captured }
}

describe('listWorkOrderVisitAllocations', () => {
  it("applies kind='base' when the caller asks for base claims", async () => {
    const { db, captured } = stubDb()
    await listWorkOrderVisitAllocations(db, ORG, 'wo_1', { visitKind: 'base' })
    expect(params(captured.findMany[0]?.where)).toEqual([ORG, 'wo_1', 'active', 'base'])
  })

  it("omits the kind predicate for 'any', so extra-work claims count too", async () => {
    const { db, captured } = stubDb()
    await listWorkOrderVisitAllocations(db, ORG, 'wo_1', { visitKind: 'any' })
    expect(params(captured.findMany[0]?.where)).toEqual([ORG, 'wo_1', 'active'])
  })
})

describe('listWorkOrderAllocations', () => {
  it('reads the three tables and passes visitKind through to the visit table', async () => {
    const { db, captured } = stubDb()
    const result = await listWorkOrderAllocations(db, ORG, 'wo_1', { visitKind: 'base' })
    expect(Object.keys(result)).toEqual([
      'lineAllocations',
      'visitAllocations',
      'scheduleAllocations',
    ])
    expect(captured.findMany.map((call) => call.table).sort()).toEqual([
      'InvoiceLineAllocation',
      'InvoiceScheduleAllocation',
      'InvoiceVisitAllocation',
    ])
    const visit = captured.findMany.find((call) => call.table === 'InvoiceVisitAllocation')
    expect(params(visit?.where)).toEqual([ORG, 'wo_1', 'active', 'base'])
    for (const call of captured.findMany) {
      expect(params(call.where)[0]).toBe(ORG)
    }
  })

  it("carries visitKind 'any' into the visit table", async () => {
    const { db, captured } = stubDb()
    await listWorkOrderAllocations(db, ORG, 'wo_1', { visitKind: 'any' })
    const visit = captured.findMany.find((call) => call.table === 'InvoiceVisitAllocation')
    expect(params(visit?.where)).toEqual([ORG, 'wo_1', 'active'])
  })
})

describe('listVisitAllocationsForVisits', () => {
  it('short-circuits on an empty visit list rather than issuing an empty IN', async () => {
    const { db, captured } = stubDb()
    expect(await listVisitAllocationsForVisits(db, ORG, [], { visitKind: 'base' })).toEqual([])
    expect(captured.findMany).toHaveLength(0)
  })

  it('scopes by organization, visit ids and active status', async () => {
    const { db, captured } = stubDb()
    await listVisitAllocationsForVisits(db, ORG, ['v1', 'v2'], { visitKind: 'any' })
    expect(params(captured.findMany[0]?.where)).toEqual([ORG, 'v1', 'v2', 'active'])
  })
})

describe('listInstallments', () => {
  it('orders by sortOrder and applies no status filter by default', async () => {
    const { db, captured } = stubDb()
    await listInstallments(db, ORG, 'wo_1')
    const call = captured.findMany[0]
    expect(call?.table).toBe('WorkOrderBillingInstallment')
    expect(params(call?.where)).toEqual([ORG, 'wo_1'])
    expect(call?.orderBy).toHaveLength(1)
  })

  it('accepts one status', async () => {
    const { db, captured } = stubDb()
    await listInstallments(db, ORG, 'wo_1', { status: 'pending' })
    expect(params(captured.findMany[0]?.where)).toEqual([ORG, 'wo_1', 'pending'])
  })

  it('accepts a status list', async () => {
    const { db, captured } = stubDb()
    await listInstallments(db, ORG, 'wo_1', { status: ['pending', 'drafted', 'invoiced'] })
    expect(params(captured.findMany[0]?.where)).toEqual([
      ORG,
      'wo_1',
      'pending',
      'drafted',
      'invoiced',
    ])
  })
})

describe('releaseLineAllocations', () => {
  it('scopes the by-invoice release to the organization and active rows', async () => {
    const { db, captured } = stubDb()
    await releaseLineAllocations(db, ORG, { invoiceId: 'inv_1' })
    const update = captured.updates[0]
    expect(update?.set.status).toBe('released')
    expect(update?.set.releasedAt).toBeInstanceOf(Date)
    expect(params(update?.where)).toEqual([ORG, 'active', 'inv_1'])
  })

  it('scopes the by-line release to the organization', async () => {
    const { db, captured } = stubDb()
    await releaseLineAllocations(db, ORG, { invoiceLineItemId: 'line_1' })
    expect(params(captured.updates[0]?.where)).toEqual([ORG, 'active', 'line_1'])
  })

  it('org-scopes the by-id release — the copy it replaces matched on id alone', async () => {
    const { db, captured } = stubDb()
    await releaseLineAllocations(db, ORG, { ids: ['alloc_1', 'alloc_2'] })
    expect(params(captured.updates[0]?.where)).toEqual([ORG, 'active', 'alloc_1', 'alloc_2'])
  })

  it('does nothing for an empty id list', async () => {
    const { db, captured } = stubDb()
    await releaseLineAllocations(db, ORG, { ids: [] })
    expect(captured.updates).toHaveLength(0)
  })
})
