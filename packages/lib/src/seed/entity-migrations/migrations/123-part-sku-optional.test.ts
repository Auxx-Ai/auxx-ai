// packages/lib/src/seed/entity-migrations/migrations/123-part-sku-optional.test.ts
//
// Migration 123 is a single required-flag flip, so what can silently go wrong
// is the wiring: the registry must carry the same optionality the migration
// writes (or fresh orgs and migrated orgs diverge), the SKU must stay unique
// (the migration only touches `required`), and the migration must be
// registered exactly once. These tests pin all three, the way 104's do.

import { describe, expect, it } from 'vitest'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration123PartSkuOptional } from './123-part-sku-optional'

describe('migration 123 registration', () => {
  it('is registered exactly once, after 122, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '123-part-sku-optional')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('123-part-sku-optional')).toBe(
      ids.indexOf('122-order-shipping-and-note') + 1
    )
    expect(migration123PartSkuOptional.id).toBe('123-part-sku-optional')
  })

  it('does not reuse an id already spent in the shared space', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id.startsWith('123-'))).toEqual(['123-part-sku-optional'])
  })
})

describe('registry agrees with the migration', () => {
  // Fresh orgs seed CustomField.required from the registry capabilities;
  // existing orgs get this migration. If the registry still said required,
  // whether a blank-SKU Shopify variant creates a part would depend on when
  // the org signed up.
  it('sku is optional in the registry', () => {
    expect(PART_FIELDS.sku?.nullable).toBe(true)
    expect(PART_FIELDS.sku?.capabilities.required).toBe(false)
  })

  it('sku stays unique and an identifier: optional is not the same as free-form', () => {
    expect(PART_FIELDS.sku?.capabilities.unique).toBe(true)
    expect(PART_FIELDS.sku?.isIdentifier).toBe(true)
  })
})
