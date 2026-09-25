// packages/lib/src/inventory/costing/__tests__/dated-reads.test.ts
//
// The dated ledger reads (111 D23 / Q26), against a pg-proxy drizzle so the SQL the builder
// renders is what is asserted: the date bound, the `adjust_subparts` exclusion, and the
// COALESCE onto `createdAt` for a row written without a date.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  /** Positional rows the next query answers with: `[partId, value]`. */
  rows: [] as unknown[][],
}))

vi.mock('@auxx/database', async () => {
  const { boolean, doublePrecision, pgTable, text, timestamp } = await import('drizzle-orm/pg-core')
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  const FieldValue = pgTable('FieldValue', {
    organizationId: text('organizationId').notNull(),
    entityId: text('entityId').notNull(),
    fieldId: text('fieldId').notNull(),
    relatedEntityId: text('relatedEntityId'),
    valueNumber: doublePrecision('valueNumber'),
    valueBoolean: boolean('valueBoolean'),
    valueDate: timestamp('valueDate'),
  })
  const EntityInstance = pgTable('EntityInstance', {
    id: text('id').primaryKey(),
    organizationId: text('organizationId').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  })
  const database = drizzle(async (sql, params) => {
    h.queries.push({ sql, params })
    return { rows: h.rows }
  })
  return { database, schema: { FieldValue, EntityInstance } }
})

vi.mock('../../../resources/system-records', () => ({
  systemFieldMap: async () => ({
    stock_movement_quantity: { id: 'f_qty' },
    stock_movement_part: { id: 'f_part' },
    stock_movement_adjust_subparts: { id: 'f_flag' },
    stock_movement_occurred_at: { id: 'f_occ' },
  }),
}))

import { readEarliestMovementAt, readPartNetThrough } from '../dated-reads'

const ORG = 'org_1'
const THROUGH = new Date('2026-09-23T23:59:59.999Z')

beforeEach(() => {
  h.queries = []
  h.rows = []
})

describe('readPartNetThrough', () => {
  it('sums quantity per part, bounded by COALESCE(occurredAt, createdAt) <= through', async () => {
    h.rows = [
      ['part_a', '40'],
      ['part_b', '-3'],
    ]
    const result = await readPartNetThrough(ORG, ['part_a', 'part_b', 'part_c'], THROUGH)

    expect(result.get('part_a')).toBe(40)
    expect(result.get('part_b')).toBe(-3)
    // A part with no movement in range reads 0, not absent.
    expect(result.get('part_c')).toBe(0)

    const [query] = h.queries
    expect(query?.sql).toContain(
      'COALESCE("dated_occurred"."valueDate", "EntityInstance"."createdAt") <= $'
    )
    expect(query?.params).toContain(THROUGH)
    expect(query?.sql).toContain('SUM("dated_qty"."valueNumber")')
    expect(query?.sql).toContain('group by "dated_part"."relatedEntityId"')
  })

  it('excludes adjust_subparts rows exactly as batchRecalculateQoH does', async () => {
    await readPartNetThrough(ORG, ['part_a'], THROUGH)
    const [query] = h.queries
    expect(query?.sql).toContain(
      '("dated_flag"."valueBoolean" IS NULL OR "dated_flag"."valueBoolean" = false)'
    )
    // The flag and the date are LEFT joins: a row missing either still counts.
    expect(query?.sql).toMatch(/left join "FieldValue" "dated_flag"/)
    expect(query?.sql).toMatch(/left join "FieldValue" "dated_occurred"/)
    expect(query?.params).toEqual(expect.arrayContaining(['f_qty', 'f_part', 'f_flag', 'f_occ']))
  })

  it('reads nothing for an empty part list', async () => {
    expect(await readPartNetThrough(ORG, [], THROUGH)).toEqual(new Map())
    expect(h.queries).toHaveLength(0)
  })

  it('de-duplicates the part ids it binds', async () => {
    await readPartNetThrough(ORG, ['part_a', 'part_a'], THROUGH)
    const bound = h.queries[0]?.params.filter((p) => p === 'part_a')
    expect(bound).toHaveLength(1)
  })
})

describe('readEarliestMovementAt', () => {
  it('takes MIN of the coalesced date per part, null for a part with no movements', async () => {
    h.rows = [['part_a', '2026-01-05T10:00:00.000Z']]
    const result = await readEarliestMovementAt(ORG, ['part_a', 'part_b'])

    expect(result.get('part_a')).toEqual(new Date('2026-01-05T10:00:00.000Z'))
    expect(result.get('part_b')).toBeNull()

    const [query] = h.queries
    expect(query?.sql).toContain(
      'MIN(COALESCE("dated_occurred"."valueDate", "EntityInstance"."createdAt"))'
    )
    expect(query?.sql).toContain('("dated_flag"."valueBoolean" IS NULL OR')
    // No date bound: the earliest is over the whole ledger.
    expect(query?.sql).not.toContain('<= $')
  })
})
