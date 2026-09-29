// packages/lib/src/inventory/receiving/__tests__/movement-coverage.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  partDefId: 'def_part' as string | undefined,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
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
vi.mock('../../../cache', () => ({ getCachedEntityDefId: async () => h.partDefId }))

import { database } from '@auxx/database'
import { readPartsWithInitialMovement, readPartsWithMovements } from '../movement-coverage'

const db = database as never

beforeEach(() => {
  h.partDefId = 'def_part'
  h.queries = []
  h.rows = []
})

describe('readPartsWithMovements', () => {
  it('probes each part for a movement in one statement', async () => {
    h.rows = [['part_1'], ['part_2']]
    expect(await readPartsWithMovements(db, 'org_1')).toEqual(new Set(['part_1', 'part_2']))
    expect(h.queries).toHaveLength(1)
    expect(h.queries[0]?.sql).toContain('exists (select "id" from "StockMovement"')
    expect(h.queries[0]?.params).toContain('def_part')
  })

  it('reads nothing on an org with no part definition', async () => {
    h.partDefId = undefined
    expect(await readPartsWithMovements(db, 'org_1')).toEqual(new Set())
    expect(h.queries).toHaveLength(0)
  })
})

describe('readPartsWithInitialMovement', () => {
  it('answers the parts that carry an initial', async () => {
    h.rows = [['part_1']]
    expect(await readPartsWithInitialMovement(db, 'org_1')).toEqual(new Set(['part_1']))
    expect(h.queries[0]?.params).toContain('initial')
  })
})
