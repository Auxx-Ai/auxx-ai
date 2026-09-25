// packages/lib/src/accounting/ledger/post/__tests__/sweep-unposted-inventory.test.ts
//
// The inventory catch-up (111 Q22b). The candidate query is built with Drizzle's
// own query builder against stand-in tables and rendered to SQL, so the three
// exclusions and the cutover floor are asserted on the statement itself; the
// rows it names are then posted through a stubbed document poster.

import { pgTable, QueryBuilder, text, timestamp } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface StoredRow {
  movementId: string
  partInstanceId: string
  type: string
  quantity: number
  extendedCost: number | null
  costBasis: string | null
  pending: boolean
  glAccount: string
  occurredAt: Date
  fulfillmentLineId?: string | null
  buildId?: string | null
}

const h = vi.hoisted(() => ({
  ids: [] as string[],
  rows: new Map<string, StoredRow>(),
  lineFulfillment: new Map<string, string>(),
  settings: { 'accounting.cutoffPeriod': '2026-06' } as Record<string, string | null>,
  postDocument: vi.fn(async (..._args: unknown[]) => ({ status: 'posted' })),
  captured: [] as { sql: string; params: unknown[] }[],
}))

vi.mock('@auxx/database', async () => {
  const { pgTable, text, timestamp, doublePrecision, boolean } = await import('drizzle-orm/pg-core')
  return {
    schema: {
      FieldValue: pgTable('FieldValue', {
        entityId: text().notNull(),
        fieldId: text().notNull(),
        organizationId: text().notNull(),
        optionId: text(),
        valueNumber: doublePrecision(),
        valueDate: timestamp({ withTimezone: true }),
        valueBoolean: boolean(),
      }),
      EntityInstance: pgTable('EntityInstance', {
        id: text().primaryKey(),
        organizationId: text().notNull(),
        entityDefinitionId: text().notNull(),
        archivedAt: timestamp({ withTimezone: true }),
        createdAt: timestamp({ withTimezone: true }).notNull(),
      }),
      GlPostingSource: pgTable('GlPostingSource', {
        organizationId: text().notNull(),
        glPostingId: text().notNull(),
        sourceKind: text().notNull(),
        sourceId: text().notNull(),
        linkRole: text().notNull(),
      }),
      GlPosting: pgTable('GlPosting', {
        id: text().primaryKey(),
        status: text().notNull(),
      }),
    },
  }
})
vi.mock('../../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'user_system' }) }))
vi.mock('../../../../resources/system-records', () => ({
  systemDefId: async () => 'def_mv',
  systemFieldMap: async (_db: unknown, _org: string, attrs: string[]) =>
    Object.fromEntries(attrs.map((attr) => [attr, { id: `f_${attr}` }])),
}))
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async () => h.settings,
}))
vi.mock('../post-inventory-document', () => ({
  postInventoryDocument: h.postDocument,
  readInventoryDocumentRows: async (_db: unknown, _org: string, ids: string[]) =>
    ids.flatMap((id) => (h.rows.has(id) ? [h.rows.get(id)!] : [])),
  readFulfillmentLineParents: async (_db: unknown, _org: string, lineIds: string[]) =>
    new Map(
      lineIds.flatMap((id) =>
        h.lineFulfillment.has(id)
          ? [[id, { fulfillmentId: h.lineFulfillment.get(id)!, orderId: 'ord_1' }]]
          : []
      )
    ),
}))

import { sweepUnpostedInventory } from '../sweep-unposted-inventory'

// A real Drizzle query builder: subqueries render as SQL, and an awaited select resolves
// `h.ids` after recording the statement it would have run.
const qb = new QueryBuilder()
const probe = qb.select().from(pgTable('probe', { id: text(), at: timestamp() }))
const selectProto = Object.getPrototypeOf(probe) as { then?: unknown }
// biome-ignore lint/suspicious/noThenProperty: the builder has no session; awaiting it is what the fake resolves.
selectProto.then = function (
  this: { toSQL(): { sql: string; params: unknown[] } },
  resolve: (v: unknown) => void
) {
  h.captured.push(this.toSQL())
  resolve(h.ids.map((id) => ({ id })))
}
const db = {
  select: (fields?: Parameters<QueryBuilder['select']>[0]) =>
    fields ? qb.select(fields) : qb.select(),
  transaction: async (run: (tx: unknown) => unknown) => run({}),
} as never

const ORG = 'org_1'

function stored(movementId: string, extra: Partial<StoredRow> = {}): StoredRow {
  return {
    movementId,
    partInstanceId: 'part_1',
    type: 'adjust',
    quantity: 2,
    extendedCost: 2_000,
    costBasis: 'standard',
    pending: false,
    glAccount: 'inventory_raw_materials',
    occurredAt: new Date('2026-08-01T00:00:00Z'),
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.ids = []
  h.rows = new Map()
  h.lineFulfillment = new Map([['line_1', 'ful_1']])
  h.settings = { 'accounting.cutoffPeriod': '2026-06' }
  h.captured = []
})

describe('the candidate statement', () => {
  it('names only valued rows after the cutover in no posted entry, oldest first, capped', async () => {
    await sweepUnpostedInventory(db, { organizationId: ORG, limit: 7 })

    const { sql, params } = h.captured.at(-1)!
    // Dated after the cutover month's last day.
    expect(params).toContain('2026-06-30')
    expect(sql).toMatch(/"valueDate"::date > \$\d+/)
    // A pending row, a return to the vendor and a row already in a posted entry are excluded.
    expect(sql.match(/not in \(select/gi)).toHaveLength(3)
    expect(params).toContain('pending')
    expect(params).toContain('return_out')
    expect(params).toContain('member')
    expect(params).toContain('posted')
    expect(params).toContain('stock_movement')
    // Valued: a cost row that is not null and not zero.
    expect(sql).toMatch(/"valueNumber" is not null and "movement_cost"\."valueNumber" <> \$\d+/)
    expect(sql).toMatch(
      /order by "FieldValue"\."valueDate" asc, "EntityInstance"\."createdAt" asc limit \$\d+/
    )
    expect(params).toContain(7)
  })

  it('has no floor when the org has no cutover month', async () => {
    h.settings = { 'accounting.cutoffPeriod': null }
    await sweepUnpostedInventory(db, { organizationId: ORG })
    expect(h.captured.at(-1)!.sql).not.toMatch(/::date >/)
  })
})

describe('what it posts', () => {
  it('posts each lone row as its own document, a dispatch as one pass and a build once', async () => {
    h.ids = ['mv_a', 'mv_s1', 'mv_s2', 'mv_c', 'mv_p']
    h.rows = new Map([
      ['mv_a', stored('mv_a')],
      [
        'mv_s1',
        stored('mv_s1', {
          type: 'sale',
          quantity: -1,
          extendedCost: -1_000,
          fulfillmentLineId: 'line_1',
        }),
      ],
      [
        'mv_s2',
        stored('mv_s2', {
          type: 'sale',
          quantity: -1,
          extendedCost: -1_000,
          fulfillmentLineId: 'line_1',
        }),
      ],
      [
        'mv_c',
        stored('mv_c', {
          type: 'build_consume',
          quantity: -2,
          extendedCost: -400,
          buildId: 'build_1',
        }),
      ],
      [
        'mv_p',
        stored('mv_p', {
          type: 'build_produce',
          quantity: 1,
          extendedCost: 400,
          buildId: 'build_1',
        }),
      ],
    ])

    const counts = await sweepUnpostedInventory(db, { organizationId: ORG })

    expect(counts).toEqual({ scanned: 5, posted: 3, failed: 0 })
    const documents = h.postDocument.mock.calls.map((call) =>
      (call[2] as unknown as StoredRow[]).map((row) => row.movementId)
    )
    expect(documents).toEqual([['mv_a'], ['mv_c', 'mv_p'], ['mv_s1', 'mv_s2']])
    expect(h.postDocument).toHaveBeenCalledWith(db, ORG, expect.anything(), {
      actorUserId: 'user_system',
    })
  })

  it('drops a row the reader finds pending or zero-valued, whatever the statement said', async () => {
    h.ids = ['mv_pending', 'mv_zero', 'mv_ok']
    h.rows = new Map([
      [
        'mv_pending',
        stored('mv_pending', { pending: true, costBasis: 'pending', extendedCost: null }),
      ],
      ['mv_zero', stored('mv_zero', { extendedCost: 0 })],
      ['mv_ok', stored('mv_ok')],
    ])

    const counts = await sweepUnpostedInventory(db, { organizationId: ORG })

    expect(counts).toEqual({ scanned: 1, posted: 1, failed: 0 })
    expect(h.postDocument).toHaveBeenCalledTimes(1)
  })

  it('counts a declined or thrown document as failed and carries on', async () => {
    h.ids = ['mv_a', 'mv_b', 'mv_c']
    h.rows = new Map([
      ['mv_a', stored('mv_a')],
      ['mv_b', stored('mv_b', { type: 'return_in' })],
      ['mv_c', stored('mv_c')],
    ])
    h.postDocument
      .mockResolvedValueOnce({ status: 'account_unmapped' })
      .mockRejectedValueOnce(new Error('ledger down'))
      .mockResolvedValueOnce({ status: 'posted' })

    const counts = await sweepUnpostedInventory(db, { organizationId: ORG })

    expect(counts).toEqual({ scanned: 3, posted: 1, failed: 2 })
  })

  it('does nothing when nothing is unposted', async () => {
    const counts = await sweepUnpostedInventory(db, { organizationId: ORG })
    expect(counts).toEqual({ scanned: 0, posted: 0, failed: 0 })
    expect(h.postDocument).not.toHaveBeenCalled()
  })
})
