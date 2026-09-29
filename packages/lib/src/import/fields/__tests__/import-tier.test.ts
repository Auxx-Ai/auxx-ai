// packages/lib/src/import/fields/__tests__/import-tier.test.ts

import { type ResourceFieldId, toFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import type { Resource } from '../../../resources/registry/types'
import { BaseType } from '../../../resources/types'
import { getImportableFields } from '../get-importable-fields'
import { getImportTier } from '../import-tier'

function field(overrides: Partial<ResourceField> = {}): ResourceField {
  return {
    id: toFieldId('note'),
    key: 'note',
    label: 'Note',
    type: BaseType.STRING,
    isSystem: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    ...overrides,
  } as ResourceField
}

const capabilities = field().capabilities

/** A registry resource as its static declarations, the shape the merge promotes from. */
const registryResource = (id: string): Resource =>
  ({ id, fields: Object.values(RESOURCE_FIELD_REGISTRY[id] ?? {}) }) as unknown as Resource

describe('getImportTier', () => {
  it('is required when capabilities.required is set', () => {
    expect(getImportTier(field({ capabilities: { ...capabilities, required: true } }))).toBe(
      'required'
    )
  })

  it('is required for a natural-key leg even when not declared required', () => {
    expect(getImportTier(field({ naturalKeyPosition: 1 }))).toBe('required')
  })

  it('lets required win over a recommended hint', () => {
    expect(getImportTier(field({ naturalKeyPosition: 2, importHint: 'recommended' }))).toBe(
      'required'
    )
  })

  it('is recommended when the registry declares the hint', () => {
    expect(getImportTier(field({ importHint: 'recommended' }))).toBe('recommended')
  })

  it('is undefined otherwise', () => {
    expect(getImportTier(field())).toBeUndefined()
  })
})

describe('getImportableFields carries importTier on every pass', () => {
  const resource = {
    fields: [
      field({
        key: 'code',
        isIdentifier: true,
        capabilities: { ...capabilities, required: true, unique: true },
      }),
      field({ key: 'price', importHint: 'recommended' }),
      field({
        key: 'owner',
        type: BaseType.RELATION,
        naturalKeyPosition: 1,
        relationship: {
          inverseResourceFieldId: 'contact:owned' as ResourceFieldId,
          relationshipType: 'belongs_to',
          isInverse: false,
        },
      }),
      field({ key: 'note' }),
    ],
  } as unknown as Resource

  const tiers = Object.fromEntries(
    getImportableFields(resource, { includeIdentifiers: true }).map((f) => [f.key, f.importTier])
  )

  it('sets the tier on identifier, scalar and relation entries', () => {
    expect(tiers).toEqual({
      code: 'required',
      price: 'recommended',
      owner: 'required',
      note: undefined,
    })
  })
})

describe('registry import hints', () => {
  it('vendor_part: Part and Supplier required, the six pricing fields recommended', () => {
    const fields = getImportableFields(registryResource('vendor_part'), {
      includeIdentifiers: true,
    })
    const byTier = (tier: string) =>
      fields
        .filter((f) => f.importTier === tier)
        .map((f) => f.label)
        .sort()

    expect(byTier('required')).toEqual(['Part', 'Supplier'])
    expect(byTier('recommended')).toEqual(
      [
        'Unit Price',
        'Vendor SKU',
        'Lead Time',
        'Min Order Qty',
        'Purchase Unit',
        'Units per Purchase Unit',
      ].sort()
    )
  })

  it('every hinted field is importable, so the hint can never point at a dead row', () => {
    const offenders: string[] = []
    for (const [resourceId, fields] of Object.entries(RESOURCE_FIELD_REGISTRY)) {
      for (const f of Object.values(fields ?? {}) as ResourceField[]) {
        if (f.importHint && (!f.capabilities.creatable || f.capabilities.hidden)) {
          offenders.push(`${resourceId}.${f.key}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
