// packages/lib/src/import/resolution/__tests__/update-value-resolution.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
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

class FakeDb {
  mappingProp: { id: string; resolutionType: string }
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

  constructor(resolutionType: string) {
    this.mappingProp = { id: 'prop_0', resolutionType }
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
