// packages/lib/src/entity-templates/app-template-projector.test.ts
// Covers the manifest → EntityTemplate projection (v6): one template per unique owned
// `key`, stable `sourceKey`, `appFieldKey == templateFieldId` on every field, and the
// parent↔child relationship edges emitted as `@template:`/`@system:` RELATIONSHIP fields.

import type { CatalogDataConnector } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { appTemplateId, projectAppConnectorTemplates } from './app-template-projector'

const CONNECTOR: CatalogDataConnector = {
  id: 'shopify.core',
  label: 'Shopify Core',
  requiresConnection: true,
  iconKey: 'shopping-bag',
  configJsonSchema: {},
  streams: [
    {
      key: 'order',
      displayFieldKey: 'name',
      fields: [
        { fieldKey: 'id', sourcePath: 'id', type: 'TEXT', name: 'Order ID' },
        { fieldKey: 'name', sourcePath: 'name', type: 'TEXT', name: 'Order Name' },
        { fieldKey: 'lineItems.sku', sourcePath: 'line_items[].sku', type: 'TEXT', name: 'SKU' },
        {
          fieldKey: 'lineItems.productId',
          sourcePath: 'line_items[].product_id',
          type: 'TEXT',
          name: 'Product ID',
        },
      ],
      defaultMappings: [
        {
          rootPath: '',
          target: {
            mode: 'owned',
            entity: {
              key: 'orders',
              apiSlug: 'shopify_orders',
              singular: 'Order',
              plural: 'Orders',
              primaryDisplayField: 'name',
            },
          },
        },
        {
          rootPath: 'customer',
          relationshipFieldKey: 'customer',
          target: { mode: 'contributing', entityKind: 'contact', matchFieldKeys: ['email'] },
        },
        {
          rootPath: 'line_items[]',
          relationshipFieldKey: 'lineItems',
          relationship: {
            fieldKey: 'lineItems',
            name: 'Line Items',
            cardinality: 'has_many',
            inverseName: 'Order',
          },
          target: {
            mode: 'owned',
            entity: {
              key: 'line_items',
              apiSlug: 'shopify_line_items',
              singular: 'Line Item',
              plural: 'Line Items',
            },
          },
        },
        {
          rootPath: 'line_items[].product_id',
          linkMode: 'reference',
          relationshipFieldKey: 'product',
          relationship: {
            fieldKey: 'product',
            name: 'Product',
            cardinality: 'belongs_to',
            inverseName: 'Line Items',
            targetRef: { ownedKey: 'products' },
          },
          target: {
            mode: 'owned',
            entity: {
              key: 'products',
              apiSlug: 'shopify_products',
              singular: 'Product',
              plural: 'Products',
            },
          },
        },
      ],
    },
  ],
}

describe('projectAppConnectorTemplates', () => {
  const templates = projectAppConnectorTemplates('shopify', 'Shopify', CONNECTOR)
  const byId = new Map(templates.map((t) => [t.id, t]))

  it('projects one template per unique owned key', () => {
    expect(templates.map((t) => t.id).sort()).toEqual([
      appTemplateId('shopify', 'line_items'),
      appTemplateId('shopify', 'orders'),
      appTemplateId('shopify', 'products'),
    ])
  })

  it('stamps the stable sourceKey on the def (not the cosmetic apiSlug)', () => {
    const orders = byId.get('app:shopify:orders')
    expect(orders?.entity.sourceKey).toBe('orders')
    expect(orders?.entity.apiSlug).toBe('shopify_orders')
  })

  it('partitions scalar columns to the owning def with appFieldKey == templateFieldId', () => {
    const orders = byId.get('app:shopify:orders')
    const scalar = orders?.fields.filter((f) => f.type !== 'RELATIONSHIP') ?? []
    // Order root owns id + name; line/product fields belong to the line_items def.
    expect(scalar.map((f) => f.templateFieldId)).toEqual(['id', 'name'])
    for (const f of scalar) expect(f.appFieldKey).toBe(f.templateFieldId)
  })

  it('emits the has_many edge on the parent (orders) def pointing to the child template', () => {
    const orders = byId.get('app:shopify:orders')
    const rel = orders?.fields.find((f) => f.type === 'RELATIONSHIP')
    expect(rel?.templateFieldId).toBe('lineItems')
    expect(rel?.relationship?.relatedResourceId).toBe('@template:app:shopify:line_items')
    expect(rel?.relationship?.relationshipType).toBe('has_many')
    expect(rel?.relationship?.inverseName).toBe('Order')
  })

  it('emits the belongs_to edge on line_items pointing to the products template (ownedKey ref)', () => {
    const lineItems = byId.get('app:shopify:line_items')
    const rel = lineItems?.fields.find((f) => f.type === 'RELATIONSHIP')
    expect(rel?.templateFieldId).toBe('product')
    expect(rel?.relationship?.relatedResourceId).toBe('@template:app:shopify:products')
  })

  it('projects the reference-only products def with no scalar columns', () => {
    const products = byId.get('app:shopify:products')
    expect(products?.fields.filter((f) => f.type !== 'RELATIONSHIP')).toEqual([])
  })

  it('does not project contributing targets (customer → contact) as templates', () => {
    expect(byId.has('app:shopify:contact')).toBe(false)
  })
})
