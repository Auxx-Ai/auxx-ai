// apps/web/src/components/dynamic-table/utils/column-id.test.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { type ResourceFieldId, toFieldId, toResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { encodeFieldPathColumnId, resolveColumnField } from './column-id'

const PART_DEF = 'hg48bniy1wotbt444j6jvbz1'
const VENDOR_PART_DEF = 'tym2o1stmyjfa6h0ilkcf828'

const PART_COST = toResourceFieldId(PART_DEF, toFieldId('m62867rj76kihokudxirma7r'))
const PART_VENDOR_PARTS = toResourceFieldId(PART_DEF, toFieldId('we3e11h48os6hdbsl06trv6z'))
const VENDOR_PART_OTHER_COST = toResourceFieldId(
  VENDOR_PART_DEF,
  toFieldId('mfv20k43ewmc54emq60plcgd')
)

function field(resourceFieldId: ResourceFieldId, overrides: Partial<ResourceField> = {}) {
  const [, id] = resourceFieldId.split(':')
  return {
    id: toFieldId(id!),
    resourceFieldId,
    key: id!,
    label: id!,
    type: 'number',
    fieldType: 'CURRENCY',
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
    },
    ...overrides,
  } as ResourceField
}

const FIELD_MAP: Record<ResourceFieldId, ResourceField> = {
  [PART_COST]: field(PART_COST),
  [PART_VENDOR_PARTS]: field(PART_VENDOR_PARTS, { fieldType: 'RELATIONSHIP', type: 'array' }),
  [VENDOR_PART_OTHER_COST]: field(VENDOR_PART_OTHER_COST),
}

const PATH_COLUMN = encodeFieldPathColumnId([PART_VENDOR_PARTS, VENDOR_PART_OTHER_COST])

describe('resolveColumnField', () => {
  it('returns null for special columns', () => {
    expect(resolveColumnField(FIELD_MAP, '_checkbox')).toBeNull()
  })

  it('returns a direct field untouched', () => {
    const resolved = resolveColumnField(FIELD_MAP, PART_COST)
    expect(resolved).toBe(FIELD_MAP[PART_COST])
    expect(resolved?.capabilities.updatable).toBe(true)
  })

  it('returns the terminal field for a path column, so display + copy keep its metadata', () => {
    const resolved = resolveColumnField(FIELD_MAP, PATH_COLUMN)
    expect(resolved?.id).toBe(FIELD_MAP[VENDOR_PART_OTHER_COST]!.id)
    expect(resolved?.fieldType).toBe('CURRENCY')
  })

  it('marks a path column non-updatable so no edit path can mount an editor', () => {
    // Regression: the terminal field belongs to another definition, so an editor
    // bound to THIS row's RecordId fetched `<thisDef>:<otherDefField>` and 500'd.
    expect(resolveColumnField(FIELD_MAP, PATH_COLUMN)?.capabilities.updatable).toBe(false)
  })

  it('does not mutate the shared field object in the store map', () => {
    resolveColumnField(FIELD_MAP, PATH_COLUMN)
    expect(FIELD_MAP[VENDOR_PART_OTHER_COST]!.capabilities.updatable).toBe(true)
  })

  it('returns null when a path segment is unknown', () => {
    const unknown = encodeFieldPathColumnId([
      PART_VENDOR_PARTS,
      toResourceFieldId(VENDOR_PART_DEF, toFieldId('doesnotexist')),
    ])
    expect(resolveColumnField(FIELD_MAP, unknown)).toBeNull()
  })

  it('returns null for an unknown direct field', () => {
    expect(resolveColumnField(FIELD_MAP, toResourceFieldId(PART_DEF, toFieldId('nope')))).toBeNull()
  })
})
