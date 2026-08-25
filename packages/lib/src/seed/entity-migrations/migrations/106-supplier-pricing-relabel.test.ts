// packages/lib/src/seed/entity-migrations/migrations/106-supplier-pricing-relabel.test.ts
//
// Migration 106 is a pure label UPDATE, so what can silently go wrong is not the
// write but the wiring around it. A label for these defs lives in THREE places —
// the seeder constants (fresh orgs), the hand-edited `ModelTypeMeta` display map,
// and every existing org's own rows (this migration) — and if they diverge, which
// name a user sees depends on when they signed up. These tests pin all three, and
// the customized-label guard that must never clobber an org's own wording.

import { ModelTypeMeta } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  migration106SupplierPricingRelabel,
  resolveDefRelabel,
  resolveLabel,
  SUPPLIER_PRICING_DEF_RELABELS,
  SUPPLIER_PRICING_FIELD_RELABELS,
} from './106-supplier-pricing-relabel'

describe('migration 106 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '106-supplier-pricing-relabel')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration106SupplierPricingRelabel.id).toBe('106-supplier-pricing-relabel')
  })

  // The two migration directories share ONE id space, so a number free in one can
  // still be taken in the other. 105 is `105-prune-dangling-relation-values`.
  it('does not reuse an id already spent in the shared space', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids).not.toContain('105-supplier-pricing-relabel')
  })
})

describe('all three label sites agree', () => {
  it('SYSTEM_ENTITIES seeds the new def labels the migration writes', () => {
    for (const spec of SUPPLIER_PRICING_DEF_RELABELS) {
      const entity = SYSTEM_ENTITIES.find((e) => e.entityType === spec.entityType)
      expect(entity, `${spec.entityType} missing from SYSTEM_ENTITIES`).toBeDefined()
      expect(entity).toMatchObject({ singular: spec.next.singular, plural: spec.next.plural })
    }
  })

  it('the hand-edited ModelTypeMeta display map carries the new labels', () => {
    expect(ModelTypeMeta.vendor_part).toMatchObject({
      label: 'Supplier Price',
      plural: 'Supplier Pricing',
    })
    expect(ModelTypeMeta.subpart).toMatchObject({ label: 'Component', plural: 'Components' })
  })

  // The part-side relation labels are the ones a user reads in the field picker
  // and the record drawer. `mergeSystemAndCustomFields` takes `label` from the DB
  // row, so the registry value below is what a FRESH org gets and the migration is
  // what an existing one gets — they have to be the same string.
  it('the part registry declares the new field labels the migration writes', () => {
    const partFields = Object.values(RESOURCE_FIELD_REGISTRY.part ?? {}) as ResourceField[]
    for (const spec of SUPPLIER_PRICING_FIELD_RELABELS) {
      const field = partFields.find((f) => f.systemAttribute === spec.systemAttribute)
      expect(field, `${spec.systemAttribute} missing from the part registry`).toBeDefined()
      expect(field?.label).toBe(spec.next)
    }
  })

  it('renames only labels — never an entityType, apiSlug or systemAttribute', () => {
    for (const spec of SUPPLIER_PRICING_DEF_RELABELS) {
      const entity = SYSTEM_ENTITIES.find((e) => e.entityType === spec.entityType)
      // These are KEYS. A rename here would orphan every slug-keyed reference.
      expect(entity?.apiSlug).toBe(spec.entityType === 'vendor_part' ? 'vendor-parts' : 'subparts')
    }
    expect(SUPPLIER_PRICING_FIELD_RELABELS.map((s) => s.systemAttribute)).toEqual([
      'part_vendor_parts',
      'part_subparts',
      'part_used_in_assemblies',
    ])
  })
})

describe('resolveLabel — the customized-label guard', () => {
  const spec = { old: 'Vendor Parts', next: 'Supplier Pricing' }

  it('updates a label still carrying the exact old seeded value', () => {
    expect(resolveLabel('Vendor Parts', spec)).toBe('update')
  })

  it('is a no-op on a re-run', () => {
    expect(resolveLabel('Supplier Pricing', spec)).toBe('up-to-date')
  })

  // An org that renamed the field owns that wording. This migration only replaces
  // what the SEEDER wrote.
  it('skips a label the org customized', () => {
    expect(resolveLabel('Our Suppliers', spec)).toBe('skip')
    expect(resolveLabel('vendor parts', spec)).toBe('skip')
    expect(resolveLabel('', spec)).toBe('skip')
  })
})

describe('resolveDefRelabel — singular and plural move together', () => {
  const spec = SUPPLIER_PRICING_DEF_RELABELS[0]!

  it('updates when both labels are the old seeded pair', () => {
    expect(resolveDefRelabel({ singular: 'Vendor Part', plural: 'Vendor Parts' }, spec)).toBe(
      'update'
    )
  })

  it('is a no-op on a re-run', () => {
    expect(
      resolveDefRelabel({ singular: 'Supplier Price', plural: 'Supplier Pricing' }, spec)
    ).toBe('up-to-date')
  })

  // Half-old is skipped WHOLE rather than half-migrated: the org touched one of
  // them, so the pair is theirs.
  it('skips a half-customized pair rather than migrating half of it', () => {
    expect(resolveDefRelabel({ singular: 'Vendor Part', plural: 'Suppliers' }, spec)).toBe('skip')
    expect(resolveDefRelabel({ singular: 'Supplier Price', plural: 'Vendor Parts' }, spec)).toBe(
      'skip'
    )
  })
})
