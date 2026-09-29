// packages/lib/src/inventory/costing/__tests__/dated-reads.test.ts
//
// The dated ledger reads (111 D23 / Q26), against a pg-proxy drizzle so the SQL the builder
// renders is what is asserted: the date bound on `effectiveAt` and the `adjustSubparts` exclusion.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  /** Positional rows the next query answers with: `[partId, value]`. */
  rows: [] as unknown[][],
}))

vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<typeof import('@auxx/database')>('@auxx/database')
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  const database = drizzle(async (sql, params) => {
    h.queries.push({ sql, params })
    return { rows: h.rows }
  })
  return { database, schema: actual.schema }
})

import { readEarliestMovementAt, readPartBuiltTotal, readPartNetThrough } from '../dated-reads'

const ORG = 'org_1'
const THROUGH = new Date('2026-09-23T23:59:59.999Z')

beforeEach(() => {
  h.queries = []
  h.rows = []
})

describe('readPartNetThrough', () => {
  it('sums quantity per part, bounded by effectiveAt <= through', async () => {
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
    expect(query?.sql).toContain('"StockMovement"."effectiveAt" <= $')
    expect(query?.params).toContain(THROUGH)
    expect(query?.sql).toContain('SUM("quantity")')
    expect(query?.sql).toContain('group by "StockMovement"."partId"')
  })

  it('excludes adjustSubparts rows exactly as batchRecalculateQoH does', async () => {
    await readPartNetThrough(ORG, ['part_a'], THROUGH)
    expect(h.queries[0]?.sql).toContain('"StockMovement"."adjustSubparts" = $')
    expect(h.queries[0]?.params).toContain(false)
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
  it('takes MIN of effectiveAt per part, null for a part with no movements', async () => {
    h.rows = [['part_a', '2026-01-05T10:00:00.000Z']]
    const result = await readEarliestMovementAt(ORG, ['part_a', 'part_b'])

    expect(result.get('part_a')).toEqual(new Date('2026-01-05T10:00:00.000Z'))
    expect(result.get('part_b')).toBeNull()

    const [query] = h.queries
    expect(query?.sql).toContain('MIN("StockMovement"."effectiveAt")')
    // No date bound: the earliest is over the whole ledger.
    expect(query?.sql).not.toContain('<= $')
  })

  it('leaves excluded movement ids out', async () => {
    await readEarliestMovementAt(ORG, ['part_a'], { excludeMovementIds: ['mv_1'] })
    expect(h.queries[0]?.sql).toContain('"StockMovement"."id" not in ($')
    expect(h.queries[0]?.params).toContain('mv_1')
  })
})

describe('readPartBuiltTotal', () => {
  it('sums build_produce rows that no movement reverses', async () => {
    h.rows = [['part_a', '12']]
    const result = await readPartBuiltTotal(ORG, ['part_a', 'part_b'])
    expect(result.get('part_a')).toBe(12)
    expect(result.get('part_b')).toBe(0)
    const [query] = h.queries
    expect(query?.params).toContain('build_produce')
    expect(query?.sql).toContain('not exists (select 1 from "StockMovement" "dated_reversal"')
  })
})
