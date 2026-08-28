// packages/lib/src/seed/entity-migrations/migrations/104-vendor-sku-optional.test.ts
//
// Migration 104 is a single required-flag flip, so what can silently go wrong
// is the wiring: the registry must carry the same optionality the migration
// writes (or fresh orgs and migrated orgs diverge), and the migration must be
// registered exactly once. These tests pin both.

import { describe, expect, it } from 'vitest'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration104VendorSkuOptional } from './104-vendor-sku-optional'

describe('migration 104 registration', () => {
  it('is registered exactly once, after 102, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '104-vendor-sku-optional')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    // This used to read `indexOf('103-gl-posting') + 1`. 103 was REMOVED from
    // the registry when the `gl_posting` def was retired (decision G6, migration
    // 114), which made `indexOf` return -1 and the assertion compare against 0 —
    // a guard that passes for the wrong reason is worse than none, so it is
    // anchored to the surviving predecessor instead.
    expect(ids.indexOf('104-vendor-sku-optional')).toBe(ids.indexOf('102-catalog-relabel') + 1)
    expect(migration104VendorSkuOptional.id).toBe('104-vendor-sku-optional')
  })
})

describe('registry agrees with the migration', () => {
  // Fresh orgs seed CustomField.required from the registry capabilities;
  // existing orgs get this migration. If the registry still said required,
  // whether a vendorSku-less price-list row imports would depend on when the
  // org signed up.
  it('vendorSku is optional in the registry', () => {
    expect(VENDOR_PART_FIELDS.vendorSku?.nullable).toBe(true)
    expect(VENDOR_PART_FIELDS.vendorSku?.capabilities.required).toBeUndefined()
  })
})
