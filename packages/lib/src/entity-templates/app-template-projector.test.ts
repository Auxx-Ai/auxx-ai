// packages/lib/src/entity-templates/app-template-projector.test.ts
// Covers the direct `CatalogEntity -> EntityTemplate` projection
// (app-fields-and-entities-plan Phase 2 §4.1): one template per declared entity,
// stable `sourceKey`, `appFieldKey == templateFieldId == key` on every field, and
// RELATIONSHIP fields resolved to `@template:`/`@system:` symbolic refs from the
// field's own `relationship.target`.

import type { CatalogEntity } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  appTemplateId,
  projectAppEntityTemplate,
  projectAppEntityTemplates,
} from './app-template-projector'

const ORDERS: CatalogEntity = {
  key: 'orders',
  apiSlug: 'shopify_orders',
  singular: 'Order',
  plural: 'Orders',
  primaryDisplayField: 'name',
  fields: [
    { key: 'shopifyId', type: 'TEXT', name: 'Shopify Order ID', identity: true },
    { key: 'name', type: 'TEXT', name: 'Order Name' },
    {
      key: 'lineItems',
      type: 'RELATIONSHIP',
      name: 'Line Items',
      relationship: {
        target: { entityKey: 'line_items' },
        cardinality: 'has_many',
        inverseName: 'Order',
      },
    },
    {
      key: 'customer',
      type: 'RELATIONSHIP',
      name: 'Customer',
      relationship: {
        target: { entityKind: 'contact' },
        cardinality: 'belongs_to',
        inverseName: 'Orders',
      },
    },
  ],
}

const LINE_ITEMS: CatalogEntity = {
  key: 'line_items',
  apiSlug: 'shopify_line_items',
  singular: 'Line Item',
  plural: 'Line Items',
  primaryDisplayField: 'sku',
  fields: [
    { key: 'sku', type: 'TEXT', name: 'SKU' },
    {
      key: 'product',
      type: 'RELATIONSHIP',
      name: 'Product',
      relationship: {
        target: { entityKey: 'products' },
        cardinality: 'belongs_to',
        inverseName: 'Line Items',
      },
    },
  ],
}

const PRODUCTS: CatalogEntity = {
  key: 'products',
  apiSlug: 'shopify_products',
  singular: 'Product',
  plural: 'Products',
  primaryDisplayField: 'title',
  fields: [{ key: 'title', type: 'TEXT', name: 'Title' }],
}

describe('projectAppEntityTemplate', () => {
  const template = projectAppEntityTemplate('shopify', ORDERS)

  it('ids the template app:<slug>:<key>', () => {
    expect(template.id).toBe(appTemplateId('shopify', 'orders'))
    expect(template.id).toBe('app:shopify:orders')
  })

  it('stamps the stable sourceKey on the def (not the cosmetic apiSlug)', () => {
    expect(template.entity.sourceKey).toBe('orders')
    expect(template.entity.apiSlug).toBe('shopify_orders')
  })

  it('projects every scalar field with appFieldKey == templateFieldId == key', () => {
    const scalar = template.fields.filter((f) => f.type !== 'RELATIONSHIP')
    expect(scalar.map((f) => f.templateFieldId)).toEqual(['shopifyId', 'name'])
    for (const f of scalar) expect(f.appFieldKey).toBe(f.templateFieldId)
  })

  it('stamps isIdentity from the catalog field, defaulting false', () => {
    const shopifyId = template.fields.find((f) => f.templateFieldId === 'shopifyId')
    const name = template.fields.find((f) => f.templateFieldId === 'name')
    expect(shopifyId?.isIdentity).toBe(true)
    expect(name?.isIdentity).toBe(false)
  })

  it('defaults owned columns to not creatable/updatable', () => {
    for (const f of template.fields) {
      expect(f.isCreatable).toBe(false)
      expect(f.isUpdatable).toBe(false)
    }
  })

  it('resolves an entityKey relationship target to a @template: symbolic ref', () => {
    const rel = template.fields.find((f) => f.templateFieldId === 'lineItems')
    expect(rel?.relationship?.relatedResourceId).toBe('@template:app:shopify:line_items')
    expect(rel?.relationship?.relationshipType).toBe('has_many')
    expect(rel?.relationship?.inverseName).toBe('Order')
  })

  it('resolves an entityKind relationship target to a @system: symbolic ref', () => {
    const rel = template.fields.find((f) => f.templateFieldId === 'customer')
    expect(rel?.relationship?.relatedResourceId).toBe('@system:contact')
    expect(rel?.relationship?.relationshipType).toBe('belongs_to')
  })
})

describe('projectAppEntityTemplates', () => {
  const templates = projectAppEntityTemplates('shopify', [ORDERS, LINE_ITEMS, PRODUCTS])
  const byId = new Map(templates.map((t) => [t.id, t]))

  it('projects one template per declared entity', () => {
    expect(templates.map((t) => t.id).sort()).toEqual([
      'app:shopify:line_items',
      'app:shopify:orders',
      'app:shopify:products',
    ])
  })

  it('cross-links every other entity as a companion (never self)', () => {
    const orders = byId.get('app:shopify:orders')
    expect(orders?.companions?.slice().sort()).toEqual([
      'app:shopify:line_items',
      'app:shopify:products',
    ])
    expect(orders?.companions).not.toContain('app:shopify:orders')
  })

  it('resolves a chained entityKey relationship (line_items -> products)', () => {
    const lineItems = byId.get('app:shopify:line_items')
    const rel = lineItems?.fields.find((f) => f.templateFieldId === 'product')
    expect(rel?.relationship?.relatedResourceId).toBe('@template:app:shopify:products')
  })

  it('projects a field-less relationship-free entity with just its scalar columns', () => {
    const products = byId.get('app:shopify:products')
    expect(products?.fields.map((f) => f.templateFieldId)).toEqual(['title'])
  })
})
