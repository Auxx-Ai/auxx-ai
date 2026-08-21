// packages/lib/src/import/fields/__tests__/identifier-eligibility.test.ts

import { toFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { getDefaultIdentifierField, getIdentifierFields } from '../../../resources/registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import type { Resource } from '../../../resources/registry/types'
import { BaseType } from '../../../resources/types'
import { getIdentifiableFields } from '../get-identifiable-fields'
import { getImportableFields } from '../get-importable-fields'
import { getIdentifierEligibility } from '../identifier-eligibility'

/**
 * Grade, don't restrict.
 *
 * Restricting the identifier picker to enforced-unique fields fails OPEN: the
 * user cannot pick a match key, so they import create-only and get exactly the
 * duplicates the restriction was meant to prevent. `(part, supplier)` on
 * `vendor_part` is two NON-unique relations and is the correct identity, so
 * "identifier ⊆ unique" would make supplier-price import permanently
 * un-updatable.
 */

function field(overrides: Partial<ResourceField> = {}): ResourceField {
  return {
    id: toFieldId('sku'),
    key: 'sku',
    label: 'SKU',
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

const resourceWith = (fields: ResourceField[]): Resource => ({ fields }) as unknown as Resource

describe('getIdentifierEligibility, the type gate', () => {
  it('offers a non-unique STRING as tier 2 with an inline note', () => {
    const eligibility = getIdentifierEligibility(field({ key: 'nickname' }))

    expect(eligibility?.tier).toBe(2)
    expect(eligibility?.note).toBe('Not enforced unique')
    expect(eligibility?.compositeOnly).toBe(false)
  })

  it('promotes a unique field to tier 1, with no note', () => {
    const eligibility = getIdentifierEligibility(
      field({ capabilities: { ...field().capabilities, unique: true } })
    )

    expect(eligibility?.tier).toBe(1)
    expect(eligibility?.note).toBeUndefined()
  })

  it('promotes a registry-declared identifier to tier 1 even without uniqueness', () => {
    // The #1788 coalesce exists precisely because 14 of 28 orgs seeded
    // `part_sku.isUnique = false` while their SKUs were de-facto unique.
    expect(getIdentifierEligibility(field({ isIdentifier: true }))?.tier).toBe(1)
  })

  it('offers EMAIL, URL, PHONE and NUMBER', () => {
    for (const type of [BaseType.EMAIL, BaseType.URL, BaseType.PHONE, BaseType.NUMBER]) {
      expect(getIdentifierEligibility(field({ type }))).not.toBeNull()
    }
  })

  it('offers a RELATION but flags it composite-only', () => {
    // A single relation column rarely identifies a record and always reads as a
    // mistake when it does, but `(part, supplier)` needs two of them.
    const eligibility = getIdentifierEligibility(
      field({ type: BaseType.RELATION, key: 'supplier' })
    )

    expect(eligibility).not.toBeNull()
    expect(eligibility?.compositeOnly).toBe(true)
  })

  it('does NOT offer BOOLEAN, CURRENCY, DATE, DATETIME or TAGS', () => {
    for (const type of [
      BaseType.BOOLEAN,
      BaseType.CURRENCY,
      BaseType.DATE,
      BaseType.DATETIME,
      BaseType.TAGS,
    ]) {
      expect(getIdentifierEligibility(field({ type }))).toBeNull()
    }
  })

  it('does NOT offer a multi-value field, whatever its type', () => {
    // "Which of these three emails identifies the record" has no answer.
    expect(
      getIdentifierEligibility(
        field({ type: BaseType.EMAIL, options: { multi: true } as ResourceField['options'] })
      )
    ).toBeNull()
  })

  it('does NOT offer a computed field', () => {
    expect(getIdentifierEligibility(field({ sourceFields: ['firstName', 'lastName'] }))).toBeNull()
    expect(
      getIdentifierEligibility(field({ capabilities: { ...field().capabilities, computed: true } }))
    ).toBeNull()
  })

  it('keeps the pre-existing filterable and hidden gates', () => {
    // The lookup filters on the field, so a non-filterable identifier is silently
    // absent rather than rejected loudly, hence the registry drift guard.
    expect(
      getIdentifierEligibility(
        field({ capabilities: { ...field().capabilities, filterable: false } })
      )
    ).toBeNull()
    expect(
      getIdentifierEligibility(field({ capabilities: { ...field().capabilities, hidden: true } }))
    ).toBeNull()
  })
})

describe('ordering, Record ID must not beat a real identifier', () => {
  const recordId = field({
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    isIdentifier: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  })
  const sku = field({ isIdentifier: true, systemAttribute: 'part_sku' } as Partial<ResourceField>)

  it('sorts Record ID last within tier 1 in the picker', () => {
    // The seeder excludes `id`, so `mergeSystemAndCustomFields` lands it in
    // `unmatchedStaticFields`, which sorts FIRST. That is exactly why the
    // planner's auto-pick has always been `id` and why no row has ever
    // classified as `update`, no CSV carries cuids.
    const offered = getIdentifiableFields(resourceWith([recordId, sku]))

    expect(offered.map((f) => f.key)).toEqual(['part_sku', 'id'])
  })

  it('getDefaultIdentifierField prefers sku over id', () => {
    expect(getDefaultIdentifierField({ fields: [recordId, sku] })?.key).toBe('sku')
  })

  it('getDefaultIdentifierField prefers email over id', () => {
    const email = field({
      id: toFieldId('email'),
      key: 'email',
      label: 'Email',
      type: BaseType.EMAIL,
      isIdentifier: true,
    })

    expect(getDefaultIdentifierField({ fields: [recordId, email] })?.key).toBe('email')
  })

  it('getDefaultIdentifierField never auto-picks a tier-2 field', () => {
    // Tier 2 exists so a HUMAN can knowingly key an import on a non-unique
    // column. Auto-selecting one would silently make an arbitrary free-text
    // field the match key for every import that never touched the identity toggle.
    const plain = field({ key: 'nickname' })

    expect(getIdentifierFields({ fields: [plain] })).toHaveLength(1)
    expect(getDefaultIdentifierField({ fields: [plain] })).toBeUndefined()
  })

  it('getDefaultIdentifierField never auto-picks a composite-only RELATION', () => {
    const relation = field({
      key: 'supplier',
      type: BaseType.RELATION,
      isIdentifier: true,
    })

    expect(getDefaultIdentifierField({ fields: [relation] })).toBeUndefined()
  })
})

describe('getIdentifierFields / getIdentifiableFields agree', () => {
  it('the registry helper and the picker offer the same set', () => {
    // These two were parallel implementations of one rule (`f.isIdentifier`),
    // so retiering the picker alone made it offer a field the planner's
    // auto-select would never choose, silently.
    const fields = [
      field({ isIdentifier: true, systemAttribute: 'part_sku' } as Partial<ResourceField>),
      field({ key: 'nickname' }),
      field({ key: 'flag', type: BaseType.BOOLEAN }),
      field({ key: 'supplier', type: BaseType.RELATION }),
    ]

    const viaRegistry = getIdentifierFields({ fields }).map((f) => f.systemAttribute ?? f.key)
    const viaPicker = getIdentifiableFields(resourceWith(fields)).map((f) => f.key)

    expect(viaPicker).toEqual(viaRegistry)
    expect(viaPicker).not.toContain('flag')
  })
})

describe('the #1788 dedupe still holds under tiering', () => {
  it('emits a creatable tier-1 identifier exactly once, keeping required and options', () => {
    const sku = field({
      isIdentifier: true,
      systemAttribute: 'part_sku',
      capabilities: { ...field().capabilities, required: true },
      options: { options: [{ value: 'a', label: 'A' }] },
    } as Partial<ResourceField>)

    const fields = getImportableFields(resourceWith([sku]), { includeIdentifiers: true })
    const entries = fields.filter((f) => f.key === 'part_sku')

    expect(entries).toHaveLength(1)
    expect(entries[0]?.group).toBe('identifier')
    expect(entries[0]?.required).toBe(true)
    expect(entries[0]?.options).toEqual([{ value: 'a', label: 'A' }])
  })

  it('leaves a tier-2 field in its natural group but still marks it eligible', () => {
    // Promoting every eligible string into the `identifier` GROUP would file
    // most of a resource's fields under that heading. The identity toggle reads
    // `identifierTier`, not `group`.
    const fields = getImportableFields(resourceWith([field({ key: 'nickname' })]), {
      includeIdentifiers: true,
    })

    expect(fields).toHaveLength(1)
    expect(fields[0]?.group).toBe('system')
    expect(fields[0]?.identifierTier).toBe(2)
    expect(fields[0]?.identifierNote).toBe('Not enforced unique')
  })

  it('does not list a composite-only RELATION under two headings', () => {
    const relation = field({
      key: 'supplier',
      type: BaseType.RELATION,
      isIdentifier: true,
      relationship: { relationshipType: 'belongs_to' } as ResourceField['relationship'],
    })

    const fields = getImportableFields(resourceWith([relation]), {
      includeIdentifiers: true,
      includeRelationships: true,
    })

    expect(fields.filter((f) => f.key === 'supplier')).toHaveLength(1)
    expect(fields[0]?.group).toBe('relationship')
    expect(fields[0]?.identifierCompositeOnly).toBe(true)
  })
})
