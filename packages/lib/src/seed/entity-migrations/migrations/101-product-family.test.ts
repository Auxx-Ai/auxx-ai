// packages/lib/src/seed/entity-migrations/migrations/101-product-family.test.ts
//
// Migration 101 is pure helper composition (the 030/040 recipe) — the helpers
// have their own coverage. What CAN silently go wrong is the wiring the
// migration depends on: a new entity type touches five hand-edited registries
// (plans/products/01-product-family.md §1's checklist), and
// `linkNewRelationships` resolves inverse pairs by string reference, so a typo
// in either direction of `part.product ↔ product.parts` or
// `product.vendor ↔ company.products` links nothing and logs only a debug
// line. These tests pin that wiring.

import { ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
import { isSystemAttribute } from '@auxx/types/system-attribute'
import { describe, expect, it } from 'vitest'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import { COMPANY_FIELDS } from '../../../resources/registry/resources/company-fields'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { PRODUCT_FIELDS } from '../../../resources/registry/resources/product-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { DISPLAY_FIELD_CONFIG, SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { migration101ProductFamily } from './101-product-family'

describe('migration 101 registration', () => {
  it('is registered exactly once, after 100, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '101-product-family')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('101-product-family')).toBe(ids.indexOf('100-part-cost-provenance') + 1)
    expect(migration101ProductFamily.id).toBe('101-product-family')
  })
})

describe('product entity registration wiring', () => {
  it('every PRODUCT_FIELDS systemAttribute is in the SystemAttribute union', () => {
    for (const [key, field] of Object.entries(PRODUCT_FIELDS)) {
      expect(field.systemAttribute, `${key} has no systemAttribute`).toBeTruthy()
      expect(
        isSystemAttribute(field.systemAttribute!),
        `${key}: '${field.systemAttribute}' missing from @auxx/types/system-attribute`
      ).toBe(true)
    }
  })

  it('carries exactly the 01 §1 field set — no option axis, nothing Shopify-shaped', () => {
    expect(Object.keys(PRODUCT_FIELDS).sort()).toEqual([
      'createdAt',
      'createdBy',
      'description',
      'handle',
      'id',
      'image',
      'parts',
      'productType',
      'status',
      'tags',
      'title',
      'updatedAt',
      'vendor',
    ])
  })

  it('tags reuses the shared open-tag `category` attribute, not a new vocabulary', () => {
    expect(PRODUCT_FIELDS.tags?.systemAttribute).toBe('category')
    expect(PRODUCT_FIELDS.tags?.systemAttribute).toBe(PART_FIELDS.category?.systemAttribute)
  })

  it('is registered in the field registry, ModelTypeValues and SYSTEM_ENTITIES', () => {
    expect(RESOURCE_FIELD_REGISTRY.product).toBe(PRODUCT_FIELDS)
    expect(ModelTypeValues).toContain('product')
    expect(ModelTypeMeta.product).toEqual({
      label: 'Product',
      plural: 'Products',
      icon: 'package-2',
      color: 'teal',
      apiSlug: 'products',
      dbTable: 'EntityInstance',
      hasDetailPage: true,
    })

    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === 'product')
    expect(entity).toMatchObject({
      apiSlug: 'products',
      singular: 'Product',
      plural: 'Products',
      icon: 'package-2', // `package` is taken by `part`
      color: 'teal',
      isVisible: true,
    })
  })

  it('display fields resolve against real PRODUCT_FIELDS keys', () => {
    const config = DISPLAY_FIELD_CONFIG.product
    expect(config?.primaryDisplayField).toBe('title')
    expect(config?.secondaryDisplayField).toBe('vendor')
    for (const key of [config?.primaryDisplayField, config?.secondaryDisplayField]) {
      expect(PRODUCT_FIELDS[key!], `display field '${key}' not in PRODUCT_FIELDS`).toBeDefined()
    }
  })
})

describe('relationship pairs', () => {
  // `linkNewRelationships` looks the inverse up by this exact string in the
  // merged field map — a mismatch on either side is a silent no-link.
  it('part.product ↔ product.parts point at each other', () => {
    expect(PART_FIELDS.product?.relationship).toMatchObject({
      inverseResourceFieldId: 'product:parts',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(PRODUCT_FIELDS.parts?.relationship).toMatchObject({
      inverseResourceFieldId: 'part:product',
      relationshipType: 'has_many',
      isInverse: true,
    })
    // The seeder pair config on the owning side names the inverse's attribute.
    expect(PART_FIELDS.product?.relationshipConfig?.inverseSystemAttribute).toBe(
      PRODUCT_FIELDS.parts?.systemAttribute
    )
    expect(PART_FIELDS.product?.systemAttribute).toBe('part_product')
    expect(PART_FIELDS.product?.nullable).toBe(true)
  })

  it('product.vendor ↔ company.products point at each other', () => {
    expect(PRODUCT_FIELDS.vendor?.relationship).toMatchObject({
      inverseResourceFieldId: 'company:products',
      relationshipType: 'belongs_to',
      isInverse: false,
    })
    expect(COMPANY_FIELDS.products?.relationship).toMatchObject({
      inverseResourceFieldId: 'product:vendor',
      relationshipType: 'has_many',
      isInverse: true,
    })
    expect(PRODUCT_FIELDS.vendor?.relationshipConfig?.inverseSystemAttribute).toBe(
      COMPANY_FIELDS.products?.systemAttribute
    )
    expect(PRODUCT_FIELDS.vendor?.systemAttribute).toBe('product_vendor')
    expect(PRODUCT_FIELDS.vendor?.nullable).toBe(true)
  })
})
