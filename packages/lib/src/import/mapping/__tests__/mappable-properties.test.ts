// packages/lib/src/import/mapping/__tests__/mappable-properties.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { getMappablePropertiesWithSamples } from '../get-mappable-properties'

/**
 * The per-file uniqueness signal.
 *
 * Field-level `isUnique` is a claim about the DATABASE. The question that
 * decides whether a column can key an import is *"can this column identify a row
 * in THIS file?"*, and a SKU column with duplicates inside the upload quietly
 * creates two records that no later import can ever match again, which
 * `isUnique` cannot see.
 *
 * The fake below performs the grouped aggregate itself so the test exercises the
 * columnIndex → counts plumbing (which is ours) rather than Postgres' `count`
 * (which is not).
 */

interface Cell {
  rowIndex: number
  columnIndex: number
  value: string
  valueHash: string
}

/** Stand-in for the ingest hash, identity is all this test needs. */
const cellsFrom = (columns: Record<number, string[]>): Cell[] =>
  Object.entries(columns).flatMap(([columnIndex, values]) =>
    values.map((value, rowIndex) => ({
      rowIndex,
      columnIndex: Number(columnIndex),
      value,
      valueHash: `h:${value}`,
    }))
  )

function fakeDb(options: {
  cells: Cell[]
  headers: Array<{ id: string; columnIndex: number; visibleName: string }>
  mappingProperties: Array<Record<string, unknown>>
}): Database {
  const thenable = (rows: unknown[]) => {
    const node: Record<string, unknown> = {
      where: () => node,
      groupBy: () => node,
      limit: () => node,
      // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder IS thenable, the fake has to be too, or `await db.select()...` never resolves.
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    }
    return node
  }

  const aggregate = () => {
    const byColumn = new Map<number, { total: number; hashes: Set<string> }>()
    for (const cell of options.cells) {
      const entry = byColumn.get(cell.columnIndex) ?? { total: 0, hashes: new Set<string>() }
      entry.total += 1
      entry.hashes.add(cell.valueHash)
      byColumn.set(cell.columnIndex, entry)
    }
    return [...byColumn.entries()].map(([columnIndex, e]) => ({
      columnIndex,
      distinct: e.hashes.size,
      total: e.total,
    }))
  }

  return {
    query: {
      ImportJobMappableProperty: { findMany: async () => options.headers },
      ImportMappingProperty: { findMany: async () => options.mappingProperties },
    },
    select: () => ({
      from: (table: unknown) => thenable(table === schema.ImportJobRawData ? aggregate() : []),
    }),
    selectDistinct: () => ({
      from: () =>
        thenable(
          [...new Set(options.cells.filter((c) => c.columnIndex === 0).map((c) => c.value))].map(
            (value) => ({ value })
          )
        ),
    }),
  } as unknown as Database
}

describe('getMappablePropertiesWithSamples, per-file uniqueness', () => {
  const headers = [
    { id: 'p0', columnIndex: 0, visibleName: 'SKU' },
    { id: 'p1', columnIndex: 1, visibleName: 'Colour' },
  ]

  it('reports distinct < total for a column with duplicates', async () => {
    const db = fakeDb({
      // Column 1 repeats, flagging it as an identifier would silently merge two parts.
      cells: cellsFrom({ 0: ['m400l', 'm400r', 'm500'], 1: ['red', 'red', 'blue'] }),
      headers,
      mappingProperties: [],
    })

    const properties = await getMappablePropertiesWithSamples(db, 'job_1', 'mapping_1')

    expect(properties[0]).toMatchObject({ distinctValueCount: 3, totalValueCount: 3 })
    expect(properties[1]).toMatchObject({ distinctValueCount: 2, totalValueCount: 3 })
  })

  it('defaults both counts to 0 for a column with no stored cells', async () => {
    const db = fakeDb({
      cells: cellsFrom({ 0: ['a'] }),
      headers,
      mappingProperties: [],
    })

    const properties = await getMappablePropertiesWithSamples(db, 'job_1', 'mapping_1')

    expect(properties[1]).toMatchObject({ distinctValueCount: 0, totalValueCount: 0 })
  })

  it('surfaces the saved identityRole and mergeStrategy per column', async () => {
    const db = fakeDb({
      cells: cellsFrom({ 0: ['a'], 1: ['b'] }),
      headers,
      mappingProperties: [
        {
          sourceColumnIndex: 0,
          targetType: 'particle',
          targetFieldKey: 'part_sku',
          customFieldId: null,
          resolutionType: 'text:value',
          resolutionConfig: JSON.stringify({
            identityRole: { kind: 'match' },
            mergeStrategy: 'fill_blank',
          }),
        },
      ],
    })

    const properties = await getMappablePropertiesWithSamples(db, 'job_1', 'mapping_1')

    expect(properties[0]?.identityRole).toEqual({ kind: 'match' })
    expect(properties[0]?.mergeStrategy).toBe('fill_blank')
    // An unmapped column reports nulls, never a stale role from another column.
    expect(properties[1]?.identityRole).toBeNull()
    expect(properties[1]?.mergeStrategy).toBeNull()
  })
})
