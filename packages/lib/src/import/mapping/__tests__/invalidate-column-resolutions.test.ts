// packages/lib/src/import/mapping/__tests__/invalidate-column-resolutions.test.ts

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it } from 'vitest'
import { invalidateColumnResolutions } from '../invalidate-column-resolutions'
import { batchUpdateMappingsFromAutoMap, saveMappingProperty } from '../save-mapping-property'

/**
 * The stale-resolution defect, pinned.
 *
 * `processColumnValues` reads `ImportValueResolution` by
 * `(importJobPropertyId, hashedValue)` before resolving anything, so re-running
 * `resolveValuesJob` after a mapping change re-resolves NOTHING unless the
 * cached rows are gone. Every assertion here is about that one fact: the picker
 * that switches a column from `select:value` to `select:create` is inert without
 * it, because the stored `error: No matching option` survives the re-run.
 *
 * The fake dispatches on TABLE reference, which is real under the shared
 * `@auxx/database` mock; COLUMN references are all `undefined` there, so
 * where-clauses are structurally unreadable and row selection is driven by the
 * call's own arguments instead. See `identifier-lifecycle.test.ts`.
 */

interface FakeProperty {
  id: string
  sourceColumnIndex: number
  sourceColumnName: string | null
  targetType: 'particle' | 'skip'
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  resolutionConfig: string | null
}

interface FakeJobProperty {
  id: string
  importMappingPropertyId: string
  uniqueValueCount: number
  resolvedCount: number
  errorCount: number
}

interface FakeResolution {
  importJobPropertyId: string
  hashedValue: string
}

class FakeDb {
  properties: FakeProperty[]
  jobProperties: FakeJobProperty[]
  resolutions: FakeResolution[]
  mapping = { identifierFieldKeys: [] as string[], defaultStrategy: 'create' }
  focusColumn = 0
  /** Every table a `delete()` was issued against, in order. */
  deletedTables: unknown[] = []

  constructor(
    properties: FakeProperty[],
    jobProperties: FakeJobProperty[],
    resolutions: FakeResolution[]
  ) {
    this.properties = properties
    this.jobProperties = jobProperties
    this.resolutions = resolutions
  }

  private rowsFor(table: unknown, limited: boolean): unknown[] {
    if (table === schema.ImportMapping) return [this.mapping]
    if (table === schema.ImportJobProperty) return this.jobProperties
    if (table === schema.ImportMappingProperty) {
      const sorted = [...this.properties].sort((a, b) => a.sourceColumnIndex - b.sourceColumnIndex)
      if (!limited) return sorted
      return sorted.filter((p) => p.sourceColumnIndex === this.focusColumn)
    }
    return []
  }

  private chain(table: unknown, limited = false): Record<string, unknown> {
    return {
      where: () => this.chain(table, limited),
      orderBy: () => this.chain(table, limited),
      limit: () => this.chain(table, true),
      for: () => this.chain(table, limited),
      // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder IS thenable, the fake has to be too.
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(this.rowsFor(table, limited)).then(resolve, reject),
    }
  }

  select() {
    return { from: (table: unknown) => this.chain(table) }
  }

  update(table: unknown) {
    const self = this
    return {
      set(values: Record<string, unknown>) {
        return {
          where: () => {
            if (table === schema.ImportMapping) Object.assign(self.mapping, values)
            if (table === schema.ImportMappingProperty) {
              const target = self.properties.find((p) => p.sourceColumnIndex === self.focusColumn)
              if (target) Object.assign(target, values)
            }
            if (table === schema.ImportJobProperty) {
              for (const jobProperty of self.jobProperties) Object.assign(jobProperty, values)
            }
            return Promise.resolve()
          },
        }
      },
    }
  }

  delete(table: unknown) {
    this.deletedTables.push(table)
    return {
      where: () => {
        if (table === schema.ImportValueResolution) {
          const live = new Set(this.jobProperties.map((p) => p.id))
          this.resolutions = this.resolutions.filter((r) => !live.has(r.importJobPropertyId))
        }
        return Promise.resolve()
      },
    }
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    return fn(this.asDatabase())
  }

  asDatabase(): Database {
    return this as unknown as Database
  }

  asTransaction(): Transaction {
    return this as unknown as Transaction
  }
}

const MAPPING_ID = 'mapping_1'

function build(resolutionType = 'select:value', targetFieldKey: string | null = 'category') {
  return new FakeDb(
    [
      {
        id: 'prop_0',
        sourceColumnIndex: 0,
        sourceColumnName: 'Category',
        targetType: targetFieldKey ? 'particle' : 'skip',
        targetFieldKey,
        customFieldId: null,
        resolutionType,
        resolutionConfig: null,
      },
    ],
    [
      {
        id: 'jobprop_0',
        importMappingPropertyId: 'prop_0',
        uniqueValueCount: 13,
        resolvedCount: 0,
        errorCount: 13,
      },
    ],
    [
      { importJobPropertyId: 'jobprop_0', hashedValue: 'h1' },
      { importJobPropertyId: 'jobprop_0', hashedValue: 'h2' },
    ]
  )
}

describe('invalidateColumnResolutions', () => {
  let db: FakeDb

  beforeEach(() => {
    db = build()
  })

  it('deletes the column resolutions and zeroes its tallies', async () => {
    await invalidateColumnResolutions(db.asTransaction(), ['prop_0'])

    expect(db.resolutions).toEqual([])
    expect(db.jobProperties[0]).toMatchObject({
      uniqueValueCount: 0,
      resolvedCount: 0,
      errorCount: 0,
    })
  })

  it('keeps the ImportJobProperty row, the re-run reuses it', async () => {
    await invalidateColumnResolutions(db.asTransaction(), ['prop_0'])

    expect(db.jobProperties).toHaveLength(1)
    expect(db.jobProperties[0]?.id).toBe('jobprop_0')
  })

  it('does nothing when no column id is given', async () => {
    await invalidateColumnResolutions(db.asTransaction(), [])

    expect(db.deletedTables).toEqual([])
    expect(db.resolutions).toHaveLength(2)
  })

  it('ignores nullish ids rather than deleting on a bad key', async () => {
    await invalidateColumnResolutions(db.asTransaction(), [undefined, null])

    expect(db.deletedTables).toEqual([])
    expect(db.resolutions).toHaveLength(2)
  })

  it('does nothing when the column has never been resolved', async () => {
    db.jobProperties = []

    await invalidateColumnResolutions(db.asTransaction(), ['prop_0'])

    expect(db.deletedTables).toEqual([])
  })
})

describe('saveMappingProperty drops stale resolutions', () => {
  it('clears them when the resolution TYPE changes on the same field', async () => {
    const db = build('select:value')

    await saveMappingProperty(db.asDatabase(), {
      mappingId: MAPPING_ID,
      columnIndex: 0,
      targetFieldKey: 'category',
      customFieldId: null,
      // The exact switch the picker exists to make.
      resolutionType: 'select:create',
    })

    expect(db.deletedTables).toContain(schema.ImportValueResolution)
    expect(db.resolutions).toEqual([])
  })

  it('clears them when the column is retargeted', async () => {
    const db = build('text:value', 'part_title')

    await saveMappingProperty(db.asDatabase(), {
      mappingId: MAPPING_ID,
      columnIndex: 0,
      targetFieldKey: 'part_description',
      customFieldId: null,
      resolutionType: 'text:value',
    })

    expect(db.resolutions).toEqual([])
  })

  it('clears them when the column is unmapped', async () => {
    const db = build('text:value', 'part_title')

    await saveMappingProperty(db.asDatabase(), {
      mappingId: MAPPING_ID,
      columnIndex: 0,
      targetFieldKey: null,
      customFieldId: null,
      resolutionType: 'text:value',
    })

    expect(db.resolutions).toEqual([])
  })

  it('KEEPS them when nothing about the reading changed', async () => {
    const db = build('select:value')

    // A policy or identity save resends the same target and the same type.
    await saveMappingProperty(db.asDatabase(), {
      mappingId: MAPPING_ID,
      columnIndex: 0,
      targetFieldKey: 'category',
      customFieldId: null,
      resolutionType: 'select:value',
      identityRole: { kind: 'match' },
    })

    expect(db.deletedTables).toEqual([])
    expect(db.resolutions).toHaveLength(2)
  })
})

describe('batchUpdateMappingsFromAutoMap drops stale resolutions', () => {
  it('clears the columns auto-map actually moved', async () => {
    const db = build('text:value', 'part_title')

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        {
          columnIndex: 0,
          matchedFieldKey: 'category',
          customFieldId: null,
          resolutionType: 'select:value',
        },
      ],
    })

    expect(db.resolutions).toEqual([])
  })

  it('leaves an unchanged column alone', async () => {
    const db = build('select:value', 'category')

    await batchUpdateMappingsFromAutoMap(db.asDatabase(), {
      mappingId: MAPPING_ID,
      mappings: [
        {
          columnIndex: 0,
          matchedFieldKey: 'category',
          customFieldId: null,
          resolutionType: 'select:value',
        },
      ],
    })

    expect(db.deletedTables).toEqual([])
    expect(db.resolutions).toHaveLength(2)
  })
})
