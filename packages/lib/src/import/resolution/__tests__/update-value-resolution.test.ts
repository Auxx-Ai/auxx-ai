// packages/lib/src/import/resolution/__tests__/update-value-resolution.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import { buildRecordData } from '../../execution/build-record-data'
import { hashValue } from '../../hashing/hash-value'
import type { ImportMappingProperty } from '../../types/mapping'
import type { ResolvedValue, ValueResolution } from '../../types/resolution'
import { updateValueResolution } from '../update-value-resolution'

/**
 * The multi-value override truncation defect, pinned.
 *
 * Every executor reads `resolvedValues[0]` ONLY (`buildRecordData`,
 * `analyzeRow`, `getPlanPreviewRows`, …), and the multiselect RESOLVER's native
 * output is a single entry whose `value` is a `string[]`
 * (`resolveMultiselectSplit`). The override writer used to expand N user
 * choices into N separate entries instead, so a 3-option override imported
 * exactly one option and silently dropped two. The writer must emit the
 * resolver's native shape: one array-valued entry for a multi-valued column.
 *
 * The fake dispatches on TABLE reference, which is real under the shared
 * `@auxx/database` mock; COLUMN references are all `undefined` there, so
 * where-clauses are structurally unreadable and rows are served from the
 * fake's own state instead. See `invalidate-column-resolutions.test.ts`.
 */

interface CapturedWrite {
  values: Record<string, unknown> | null
  conflictSet: Record<string, unknown> | null
}

// The money column's exponent is resolved at WRITE time through the org
// (`field → org → USD`), which needs the org cache and the settings table.
// Stubbed here so the assertion is about the SCALING, not about the lookup.
// `resolveColumnDecimals` is the field-precision companion, stubbed empty so
// these tests keep testing plain amount scaling (an unset `decimals` behaves
// exactly as before).
vi.mock('../resolve-currency-code', () => ({
  resolveColumnCurrencyCodes: async () => new Map([['price', 'USD']]),
  resolveColumnDecimals: async () => new Map(),
}))

class FakeDb {
  mappingProp: { id: string; resolutionType: string; targetFieldKey: string | null }
  jobProp = { id: 'jobprop_0' }
  existingResolution: Record<string, unknown> | undefined
  captured: CapturedWrite = { values: null, conflictSet: null }

  query = {
    ImportMappingProperty: {
      findFirst: async () => this.mappingProp,
    },
    ImportJobProperty: {
      findFirst: async () => this.jobProp,
    },
    ImportValueResolution: {
      findFirst: async () => this.existingResolution,
    },
  }

  constructor(resolutionType: string, targetFieldKey: string | null = 'tags') {
    this.mappingProp = { id: 'prop_0', resolutionType, targetFieldKey }
  }

  insert(table: unknown) {
    const self = this
    return {
      values(values: Record<string, unknown>) {
        if (table === schema.ImportValueResolution) self.captured.values = values
        return {
          returning: () => Promise.resolve([values]),
          onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
            if (table === schema.ImportValueResolution) self.captured.conflictSet = config.set
            return Promise.resolve()
          },
        }
      },
    }
  }

  update() {
    return { set: () => ({ where: () => Promise.resolve() }) }
  }

  asDatabase(): Database {
    return this as unknown as Database
  }
}

function override(
  db: FakeDb,
  overrideValues: Array<{ type: 'value' | 'create' | 'skip'; value: string; id?: string }>
) {
  return updateValueResolution(db.asDatabase(), {
    jobId: 'job_1',
    mappingId: 'mapping_1',
    columnIndex: 0,
    hash: hashValue('Red, Green, Blue'),
    isOverridden: true,
    overrideValues,
    organizationId: 'org_1',
    entityDefinitionId: 'def_1',
  })
}

function mapping(overrides: Partial<ImportMappingProperty>): ImportMappingProperty {
  return {
    id: 'prop_0',
    importMappingId: 'mapping_1',
    sourceColumnIndex: 0,
    sourceColumnName: 'Tags',
    targetType: 'particle',
    targetFieldKey: 'tags',
    customFieldId: null,
    resolutionType: 'multiselect:split',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('updateValueResolution multi-value overrides', () => {
  it('persists a multiselect override as ONE array-valued entry (resolver-native shape)', async () => {
    const db = new FakeDb('multiselect:split')

    await override(db, [
      { type: 'value', value: 'opt_red' },
      { type: 'value', value: 'opt_green' },
      { type: 'value', value: 'opt_blue' },
    ])

    const expected: ResolvedValue[] = [
      { type: 'value', value: ['opt_red', 'opt_green', 'opt_blue'] },
    ]
    expect(db.captured.values?.resolvedValues).toEqual(expected)
    expect(db.captured.conflictSet?.resolvedValues).toEqual(expected)
    expect(db.captured.values?.isValid).toBe(true)
  })

  it('drops skip entries mixed behind a non-skip first entry from the array', async () => {
    const db = new FakeDb('multiselect:split')

    await override(db, [
      { type: 'value', value: 'opt_red' },
      { type: 'skip', value: '' },
      { type: 'value', value: 'opt_blue' },
    ])

    expect(db.captured.values?.resolvedValues).toEqual([
      { type: 'value', value: ['opt_red', 'opt_blue'] },
    ])
  })

  it('keeps a whole-cell skip as an empty list, invalid', async () => {
    const db = new FakeDb('multiselect:split')

    await override(db, [{ type: 'skip', value: '' }])

    expect(db.captured.values?.resolvedValues).toEqual([])
    expect(db.captured.values?.isValid).toBe(false)
  })

  it('still persists a single-select override as one scalar entry', async () => {
    const db = new FakeDb('select:value')

    await override(db, [{ type: 'value', value: 'opt_red' }])

    expect(db.captured.values?.resolvedValues).toEqual([{ type: 'value', value: 'opt_red' }])
  })

  it('prefers the resolved entity id over the display value, per element', async () => {
    const db = new FakeDb('multiselect:split')

    await override(db, [
      { type: 'value', value: 'Red', id: 'opt_red' },
      { type: 'value', value: 'Blue' },
    ])

    expect(db.captured.values?.resolvedValues).toEqual([
      { type: 'value', value: ['opt_red', 'Blue'] },
    ])
  })

  it('round-trips all three options into record data via buildRecordData', async () => {
    const db = new FakeDb('multiselect:split')
    const raw = 'Red, Green, Blue'

    await override(db, [
      { type: 'value', value: 'opt_red' },
      { type: 'value', value: 'opt_green' },
      { type: 'value', value: 'opt_blue' },
    ])

    const resolutions = new Map<string, ValueResolution>([
      [
        hashValue(raw),
        {
          id: 'res_1',
          importJobPropertyId: 'jobprop_0',
          hashedValue: hashValue(raw),
          rawValue: raw,
          cellCount: 1,
          resolvedValues: db.captured.values?.resolvedValues as ResolvedValue[],
          isValid: true,
        },
      ],
    ])

    const { standardFields } = buildRecordData({ 0: raw }, [mapping({})], resolutions)
    expect(standardFields.tags).toEqual(['opt_red', 'opt_green', 'opt_blue'])
  })

  it('round-trips a single-select override into one scalar field value', async () => {
    const db = new FakeDb('select:value')
    const raw = 'Red, Green, Blue'

    await override(db, [{ type: 'value', value: 'opt_red' }])

    const resolutions = new Map<string, ValueResolution>([
      [
        hashValue(raw),
        {
          id: 'res_1',
          importJobPropertyId: 'jobprop_0',
          hashedValue: hashValue(raw),
          rawValue: raw,
          cellCount: 1,
          resolvedValues: db.captured.values?.resolvedValues as ResolvedValue[],
          isValid: true,
        },
      ],
    ])

    const { standardFields } = buildRecordData(
      { 0: raw },
      [mapping({ resolutionType: 'select:value', targetFieldKey: 'status' })],
      resolutions
    )
    expect(standardFields.status).toBe('opt_red')
  })
})

/**
 * A FREE-TEXT override is raw user input, exactly like a CSV cell, and must go
 * back through the resolver before it is stored. Only the option and relation
 * editors emit an already-resolved token; every other column is a text box.
 */
describe('updateValueResolution free-text overrides', () => {
  it('scales a typed money value into integer MINOR units', async () => {
    const db = new FakeDb('currency:major', 'price')

    await override(db, [{ type: 'value', value: '12.34' }])

    // Stored verbatim, `12.34` reached `field-value-helpers` unscaled and the
    // ROW failed at execution, long after review called the value fixed.
    expect(db.captured.values?.resolvedValues).toEqual([{ type: 'value', value: 1234 }])
  })

  it('parses a typed number instead of storing the string', async () => {
    const db = new FakeDb('number:integer', 'quantity')

    await override(db, [{ type: 'value', value: '42' }])

    expect(db.captured.values?.resolvedValues).toEqual([{ type: 'value', value: 42 }])
  })

  it('refuses a typed value the resolver cannot read', async () => {
    const db = new FakeDb('number:integer', 'quantity')

    await expect(override(db, [{ type: 'value', value: 'twelve' }])).rejects.toThrow()
    // Nothing is written: a stored error would render as a green "Fixed" tick,
    // because `deriveEffectiveStatus` reports every non-skip override as valid.
    expect(db.captured.values).toBeNull()
  })

  it('leaves an option override alone — the picker emits keys, not text', async () => {
    const db = new FakeDb('select:value', 'status')

    await override(db, [{ type: 'value', value: 'opt_red' }])

    expect(db.captured.values?.resolvedValues).toEqual([{ type: 'value', value: 'opt_red' }])
  })

  it('leaves a relation override alone — it carries the target record id', async () => {
    const db = new FakeDb('relation:match', 'supplier')

    await override(db, [{ type: 'value', value: 'Acme', id: 'rec_acme' }])

    expect(db.captured.values?.resolvedValues).toEqual([{ type: 'value', value: 'rec_acme' }])
  })
})
