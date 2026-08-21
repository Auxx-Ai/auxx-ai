// packages/lib/src/import/__tests__/importable-fields.test.ts

import { toFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import type { ResourceField } from '../../resources/registry/field-types'
import type { Resource } from '../../resources/registry/types'
import { getImportableFields } from '../fields/get-importable-fields'

/**
 * A creatable field that is ALSO an identifier (SKU, Ticket #, Email) used to be
 * emitted twice by `getImportableFields` — once by the identifier pass and once
 * by the scalar pass — so the picker listed it under two headings. That was
 * mostly invisible while `isIdentifier` came from `CustomField.isUnique` and
 * almost nothing carried it; promoting identifiers from the static registry made
 * it universal, so the passes now dedupe by output key.
 */

function resourceField(overrides: Partial<ResourceField> = {}): ResourceField {
  return {
    id: toFieldId('sku'),
    key: 'sku',
    label: 'SKU',
    type: 'string',
    isSystem: true,
    systemAttribute: 'part_sku',
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
      required: true,
    },
    ...overrides,
  } as ResourceField
}

const resourceWith = (fields: ResourceField[]): Resource => ({ fields }) as unknown as Resource

describe('getImportableFields — identifier / scalar overlap', () => {
  it('emits a creatable identifier exactly once, as the identifier entry', () => {
    const fields = getImportableFields(resourceWith([resourceField()]), {
      includeIdentifiers: true,
    })

    const sku = fields.filter((f) => f.key === 'part_sku')
    expect(sku).toHaveLength(1)
    expect(sku[0]?.isIdentifier).toBe(true)
    expect(sku[0]?.group).toBe('identifier')
  })

  it('keeps `required` and `options` on the surviving identifier entry', () => {
    // The scalar pass used to be the only carrier of these; dropping it must not
    // quietly turn a required SKU into an optional one, or blank a select's
    // option list (which `select:value` resolution needs to match against).
    const fields = getImportableFields(
      resourceWith([
        resourceField({
          options: { options: [{ value: 'a', label: 'A' }] } as ResourceField['options'],
        }),
      ]),
      { includeIdentifiers: true }
    )

    const sku = fields.find((f) => f.key === 'part_sku')
    expect(sku?.required).toBe(true)
    expect(sku?.options).toEqual([{ value: 'a', label: 'A' }])
  })

  it('still emits a non-identifier creatable field from the scalar pass', () => {
    const fields = getImportableFields(
      resourceWith([
        resourceField(),
        resourceField({
          id: toFieldId('title'),
          key: 'title',
          label: 'Title',
          systemAttribute: 'part_title',
          isIdentifier: false,
        }),
      ]),
      { includeIdentifiers: true }
    )

    expect(fields.filter((f) => f.key === 'part_title')).toHaveLength(1)
    expect(fields.find((f) => f.key === 'part_title')?.isIdentifier).toBe(false)
  })

  it('emits the field once from the scalar pass when identifiers are excluded', () => {
    const fields = getImportableFields(resourceWith([resourceField()]), {
      includeIdentifiers: false,
    })

    expect(fields.filter((f) => f.key === 'part_sku')).toHaveLength(1)
    expect(fields[0]?.isIdentifier).toBe(false)
  })
})
