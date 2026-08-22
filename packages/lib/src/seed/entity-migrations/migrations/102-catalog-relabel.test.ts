// packages/lib/src/seed/entity-migrations/migrations/102-catalog-relabel.test.ts
//
// Migration 102 is a pure label UPDATE, so what can silently go wrong is not
// the write itself but the wiring around it: the seeder constants and the
// hand-edited enums.ts display map must carry the SAME new labels the
// migration writes (or fresh orgs and migrated orgs diverge), and the
// customized-label guard must never clobber an org's own wording. These tests
// pin both.

import { ModelTypeMeta } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { CATALOG_RELABELS, migration102CatalogRelabel, resolveRelabel } from './102-catalog-relabel'

describe('migration 102 registration', () => {
  it('is registered exactly once, after 101, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '102-catalog-relabel')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('102-catalog-relabel')).toBe(ids.indexOf('101-product-family') + 1)
    expect(migration102CatalogRelabel.id).toBe('102-catalog-relabel')
  })
})

describe('label sites agree with the migration', () => {
  // Fresh orgs get their labels from SYSTEM_ENTITIES; existing orgs from this
  // migration. If the two diverge, which label an org shows depends on when it
  // signed up.
  it('SYSTEM_ENTITIES seeds the new labels the migration writes', () => {
    for (const spec of CATALOG_RELABELS) {
      const entity = SYSTEM_ENTITIES.find((e) => e.entityType === spec.entityType)
      expect(entity, `${spec.entityType} missing from SYSTEM_ENTITIES`).toBeDefined()
      expect(entity).toMatchObject({
        singular: spec.next.singular,
        plural: spec.next.plural,
      })
    }
  })

  it('the enums.ts display map carries the new labels (hand-edited registry)', () => {
    expect(ModelTypeMeta.catalog_item).toMatchObject({
      label: 'Catalog Item',
      plural: 'Catalog Items',
    })
    expect(ModelTypeMeta.catalog_group).toMatchObject({
      label: 'Catalog Group',
      plural: 'Catalog Groups',
    })
  })

  it('relabels labels ONLY — slugs and entity types are untouched', () => {
    expect(SYSTEM_ENTITIES.find((e) => e.entityType === 'catalog_item')?.apiSlug).toBe(
      'catalog-items'
    )
    expect(SYSTEM_ENTITIES.find((e) => e.entityType === 'catalog_group')?.apiSlug).toBe(
      'catalog-groups'
    )
    expect(ModelTypeMeta.catalog_item.apiSlug).toBe('catalog-items')
    expect(ModelTypeMeta.catalog_group.apiSlug).toBe('catalog-groups')
  })
})

describe('resolveRelabel (customized-label guard)', () => {
  const spec = CATALOG_RELABELS[0]

  it('updates a row still carrying both exact old seeded labels', () => {
    expect(
      resolveRelabel({ singular: 'Product / Service', plural: 'Products & Services' }, spec)
    ).toBe('update')
  })

  it('no-ops a row already carrying the new labels (idempotent re-run)', () => {
    expect(resolveRelabel({ singular: 'Catalog Item', plural: 'Catalog Items' }, spec)).toBe(
      'up-to-date'
    )
  })

  it('skips a fully customized row', () => {
    expect(resolveRelabel({ singular: 'SKU', plural: 'SKUs' }, spec)).toBe('skip')
  })

  it('skips a half-customized row rather than half-migrating it', () => {
    expect(resolveRelabel({ singular: 'Product / Service', plural: 'Store Items' }, spec)).toBe(
      'skip'
    )
    expect(resolveRelabel({ singular: 'Offering', plural: 'Products & Services' }, spec)).toBe(
      'skip'
    )
  })

  it('skips a row mixing old and new labels (never treated as seeded)', () => {
    expect(resolveRelabel({ singular: 'Catalog Item', plural: 'Products & Services' }, spec)).toBe(
      'skip'
    )
  })
})
