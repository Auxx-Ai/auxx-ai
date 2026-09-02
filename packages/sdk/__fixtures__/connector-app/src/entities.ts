// packages/sdk/__fixtures__/connector-app/src/entities.ts
//
// Definitions this app owns end to end — the owned side of the Shopify Core
// connector fixture. `orders` relates to `line_items` (same-app, `entityKey`)
// and to the platform `contact` kind (`entityKind`); `line_items` relates to
// `products` the same way.

import { defineEntity } from '@auxx/sdk/entities'

export const products = defineEntity({
  key: 'products',
  apiSlug: 'shopify_products',
  singular: 'Shopify Product',
  plural: 'Shopify Products',
  primaryDisplayField: 'title',
  fields: [
    { key: 'shopifyId', type: 'TEXT', name: 'Shopify Product ID', identity: true },
    { key: 'title', type: 'TEXT', name: 'Title' },
  ],
})

export const lineItems = defineEntity({
  key: 'line_items',
  apiSlug: 'shopify_line_items',
  singular: 'Line Item',
  plural: 'Line Items',
  primaryDisplayField: 'sku',
  fields: [
    { key: 'shopifyId', type: 'TEXT', name: 'Shopify Line Item ID', identity: true },
    { key: 'sku', type: 'TEXT', name: 'Line SKU' },
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
})

export const orders = defineEntity({
  key: 'orders',
  apiSlug: 'shopify_orders',
  singular: 'Shopify Order',
  plural: 'Shopify Orders',
  primaryDisplayField: 'name',
  fields: [
    { key: 'shopifyId', type: 'TEXT', name: 'Shopify Order ID', identity: true },
    { key: 'name', type: 'TEXT', name: 'Order Name' },
    { key: 'totalPrice', type: 'CURRENCY', name: 'Total' },
    { key: 'financialStatus', type: 'TEXT', name: 'Financial Status' },
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
  ],
})
