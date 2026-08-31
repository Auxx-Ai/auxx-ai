// packages/lib/src/seed/entity-migrations/migrations/115-vendor-part-display-part.test.ts
//
// Migration 115 is a two-column UPDATE plus a backfill, so what can silently go
// wrong is the wiring around it rather than the write:
//
//  - `DISPLAY_FIELD_CONFIG` must name the same two fields the migration writes,
//    or an org seeded before the deploy and one seeded after it disagree about
//    where a supplier price gets its name;
//  - the primary must be a field that cannot be absent — the whole defect was
//    pointing it at an optional one — so the registry's `part` leg has to stay
//    required, and `vendorSku` has to stay optional or the change is pointless;
//  - the guard has to leave a customized pointer alone while still repairing a
//    half-finished previous run.
//
// These pin all three.

import { describe, expect, it } from 'vitest'
import { VENDOR_PART_FIELDS } from '../../../resources/registry/resources/vendor-part-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { DISPLAY_FIELD_CONFIG } from '../../entity-seeder/constants'
import {
  migration115VendorPartDisplayPart,
  resolveDisplayRelink,
  VENDOR_PART_ENTITY_TYPE,
  VENDOR_PART_PART_ATTRIBUTE,
  VENDOR_PART_SKU_ATTRIBUTE,
} from './115-vendor-part-display-part'

describe('migration 115 registration', () => {
  it('is registered exactly once with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '115-vendor-part-display-part')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration115VendorPartDisplayPart.id).toBe('115-vendor-part-display-part')
  })

  it('sorts after 001, which creates the def and both fields it repoints', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.indexOf('115-vendor-part-display-part')).toBeGreaterThan(
      ids.indexOf('001-vendor-part-subpart')
    )
  })
})

describe('the seeder agrees with the migration', () => {
  const config = DISPLAY_FIELD_CONFIG[VENDOR_PART_ENTITY_TYPE]

  // 🛑 The migration reaches EXISTING orgs and this constant reaches fresh ones
  // — `linkDisplayFields` reads it at seed time only. Changing one without the
  // other is exactly the half-migration this pair exists to prevent.
  it('DISPLAY_FIELD_CONFIG seeds a fresh org with the pointers this migration writes', () => {
    expect(config, 'vendor_part missing from DISPLAY_FIELD_CONFIG').toBeDefined()
    expect(config?.primaryDisplayField).toBe('part')
    expect(config?.secondaryDisplayField).toBe('vendorSku')
  })

  it('names field KEYS that exist on the resource', () => {
    // The config is keyed by registry key, not systemAttribute — a typo here
    // makes `linkDisplayFields` silently skip the update (it `if (primaryField)`s).
    expect(VENDOR_PART_FIELDS[config!.primaryDisplayField]).toBeDefined()
    expect(VENDOR_PART_FIELDS[config!.secondaryDisplayField!]).toBeDefined()
  })

  it('maps those keys to the systemAttributes the migration looks up', () => {
    expect(VENDOR_PART_FIELDS.part?.systemAttribute).toBe(VENDOR_PART_PART_ATTRIBUTE)
    expect(VENDOR_PART_FIELDS.vendorSku?.systemAttribute).toBe(VENDOR_PART_SKU_ATTRIBUTE)
  })
})

describe('the primary display field cannot be absent', () => {
  // This is the entire point. `computeDisplayValue` returns null for an absent
  // value and has no fallback, so a display name sourced from an optional field
  // is a nameless record waiting to happen.
  it('part is required and non-nullable', () => {
    expect(VENDOR_PART_FIELDS.part?.capabilities.required).toBe(true)
    expect(VENDOR_PART_FIELDS.part?.nullable).toBe(false)
  })

  it('vendorSku is optional — the defect this migration answers', () => {
    expect(VENDOR_PART_FIELDS.vendorSku?.capabilities.required).toBeFalsy()
    expect(VENDOR_PART_FIELDS.vendorSku?.nullable).toBe(true)
  })
})

describe('resolveDisplayRelink', () => {
  const targets = { partFieldId: 'field-part', skuFieldId: 'field-sku' }

  it('updates an org still pointing at the seeded vendorSku', () => {
    expect(
      resolveDisplayRelink(
        { primaryDisplayFieldId: 'field-sku', secondaryDisplayFieldId: null },
        targets
      )
    ).toBe('update')
  })

  it('is up-to-date once primary is the part', () => {
    expect(
      resolveDisplayRelink(
        { primaryDisplayFieldId: 'field-part', secondaryDisplayFieldId: 'field-sku' },
        targets
      )
    ).toBe('up-to-date')
  })

  // Display fields ARE user-editable (`EntityDefinitionService.update` writes
  // them), which is the difference from migration 110's `isVisible`. A third
  // value is somebody's choice, not seeded state.
  it('leaves a customized pointer alone', () => {
    expect(
      resolveDisplayRelink(
        { primaryDisplayFieldId: 'field-something-else', secondaryDisplayFieldId: null },
        targets
      )
    ).toBe('skip')
  })

  it('treats an unset pointer as customized rather than guessing', () => {
    expect(
      resolveDisplayRelink({ primaryDisplayFieldId: null, secondaryDisplayFieldId: null }, targets)
    ).toBe('skip')
  })

  // A previous run that flipped primary and died before the backfill leaves this
  // shape. It must read `up-to-date` so the repair arm — not the update arm —
  // handles it, or the migration re-writes pointers that are already correct.
  it('reads a half-finished run as up-to-date, not as an update', () => {
    expect(
      resolveDisplayRelink(
        { primaryDisplayFieldId: 'field-part', secondaryDisplayFieldId: null },
        targets
      )
    ).toBe('up-to-date')
  })
})
