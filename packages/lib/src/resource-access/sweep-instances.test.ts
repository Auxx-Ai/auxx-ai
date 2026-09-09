// packages/lib/src/resource-access/sweep-instances.test.ts

/**
 * Unit coverage for {@link sweepResourceAccessForInstances}: the shape of the
 * statements it issues.
 *
 * ⚠️ The load-bearing claim — that the predicate carries NO
 * `entityDefinitionId`, so a record's rows go whichever of the two keyspaces
 * they were written under — cannot be asserted here. `src/test/setup.ts` mocks
 * `@auxx/database` wholesale and its `schema` proxy hands out tables whose
 * columns are all `undefined`, so every column reference in a predicate is
 * indistinguishable from every other. That proof is DB-backed and lives in
 * `../entity-instances/__tests__/resource-access-sweep.int.test.ts`.
 *
 * What IS checkable here is everything about the statement set: one per chunk,
 * org-scoped, deduplicated, against `ResourceAccess` and nothing else.
 */

import { schema } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every `inArray(column, values)` the sweep built, in order. */
  inArrayCalls: [] as unknown[][],
  /** Every `eq(column, value)` the sweep built, in order. */
  eqValues: [] as unknown[],
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    inArray: (column: any, values: any) => {
      h.inArrayCalls.push(values as unknown[])
      return actual.inArray(column, values)
    },
    eq: (column: any, value: any) => {
      h.eqValues.push(value)
      return actual.eq(column, value)
    },
  }
})

const { sweepResourceAccessForInstances } = await import('./sweep-instances')

/** A `tx` that records each delete and answers with `rowsPerCall` removed rows. */
function fakeTx(rowsPerCall: number[] = []) {
  const tables: unknown[] = []

  const tx = {
    delete: (table: unknown) => {
      tables.push(table)
      const index = tables.length - 1
      return {
        where: () => ({
          returning: () =>
            Promise.resolve(
              Array.from({ length: rowsPerCall[index] ?? 0 }, (_, i) => ({
                id: `ra_${index}_${i}`,
              }))
            ),
        }),
      }
    },
  }

  return { tx: tx as any, tables }
}

function reset() {
  h.inArrayCalls.length = 0
  h.eqValues.length = 0
}

describe('sweepResourceAccessForInstances', () => {
  it('is a no-op with no ids — no statement is issued', async () => {
    reset()
    const { tx, tables } = fakeTx()

    const deleted = await sweepResourceAccessForInstances(tx, {
      organizationId: 'org_1',
      instanceIds: [],
    })

    expect(deleted).toBe(0)
    expect(tables).toHaveLength(0)
  })

  it('deletes from ResourceAccess and nothing else', async () => {
    reset()
    const { tx, tables } = fakeTx([1])

    await sweepResourceAccessForInstances(tx, {
      organizationId: 'org_1',
      instanceIds: ['inst_a'],
    })

    expect(tables).toEqual([schema.ResourceAccess])
    expect(h.inArrayCalls).toEqual([['inst_a']])
  })

  it('scopes every statement to the org on its own', async () => {
    reset()
    const { tx, tables } = fakeTx([500, 100])

    await sweepResourceAccessForInstances(tx, {
      organizationId: 'org_2',
      instanceIds: Array.from({ length: 600 }, (_, i) => `inst_${i}`),
    })

    expect(tables).toHaveLength(2)
    expect(h.eqValues).toEqual(['org_2', 'org_2'])
  })

  it('chunks the id list rather than inlining it unbounded', async () => {
    reset()
    const { tx, tables } = fakeTx()

    await sweepResourceAccessForInstances(tx, {
      organizationId: 'org_1',
      instanceIds: Array.from({ length: 1001 }, (_, i) => `inst_${i}`),
    })

    expect(tables).toHaveLength(3)
    expect(h.inArrayCalls.map((ids) => ids.length)).toEqual([500, 500, 1])
    expect(h.inArrayCalls[2]).toEqual(['inst_1000'])
  })

  it('deduplicates ids and drops empty strings', async () => {
    reset()
    const { tx, tables } = fakeTx([2])

    await sweepResourceAccessForInstances(tx, {
      organizationId: 'org_1',
      instanceIds: ['inst_a', 'inst_a', '', 'inst_b'],
    })

    expect(tables).toHaveLength(1)
    expect(h.inArrayCalls).toEqual([['inst_a', 'inst_b']])
  })

  it('returns how many rows were removed, summed across chunks', async () => {
    reset()
    const { tx } = fakeTx([500, 3])

    const deleted = await sweepResourceAccessForInstances(tx, {
      organizationId: 'org_1',
      instanceIds: Array.from({ length: 501 }, (_, i) => `inst_${i}`),
    })

    expect(deleted).toBe(503)
  })
})
