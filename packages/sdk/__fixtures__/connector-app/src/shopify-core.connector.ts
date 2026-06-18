// packages/sdk/__fixtures__/connector-app/src/shopify-core.connector.ts
//
// The Shopify Core data connector — the first real app-connector (phase 4).
// Declares an `order` stream (source schema for one order, incl. embedded
// customer + line_items) plus the recommended fan-out: order root → owned
// shopify_orders def, customer → contributing contact (match on email),
// line_items[] → owned shopify_line_items, line_items[].product_id → reference
// to shopify_products. The platform validates + maps + writes — this app only
// declares the shape + ships the `execute` fetch handler.
//
// See plans/data-connectors/claude/03-connectors-and-sources.md §3-4.

import { defineDataConnector } from '@auxx/sdk/data-connectors'
import { z } from 'zod/v4'
import shopifyCoreSync from './shopify-core.connector.server'

export const shopifyCoreDataConnector = defineDataConnector({
  id: 'shopify.core',
  label: 'Shopify Core Data',
  requiresConnection: true,
  iconKey: 'shopping-bag',
  config: z.object({
    includeDraftProducts: z.boolean().default(false),
  }),
  streams: [
    {
      key: 'order',
      displayFieldKey: 'name',
      // SOURCE schema (Layer A) — the shape of one fetched order, including the
      // embedded customer + line_items. PII flags on customer fields are
      // surfaced + default-excluded in the mapping UI.
      fields: {
        id: { type: 'TEXT', name: 'Order ID', sourcePath: 'id' },
        name: { type: 'TEXT', name: 'Order Name', sourcePath: 'name' },
        totalPrice: { type: 'CURRENCY', name: 'Total', sourcePath: 'total_price' },
        financialStatus: {
          type: 'TEXT',
          name: 'Financial Status',
          sourcePath: 'financial_status',
        },
        'customer.email': {
          type: 'EMAIL',
          name: 'Customer Email',
          sourcePath: 'customer.email',
          pii: true,
        },
        'customer.firstName': {
          type: 'TEXT',
          name: 'Customer First',
          sourcePath: 'customer.first_name',
          pii: true,
        },
        'lineItems.sku': { type: 'TEXT', name: 'Line SKU', sourcePath: 'line_items[].sku' },
        'lineItems.productId': {
          type: 'TEXT',
          name: 'Line Product ID',
          sourcePath: 'line_items[].product_id',
        },
      },
      // Recommended fan-out — root + each embedded branch + the id-only ref.
      // The user confirms/overrides at setup; branches not declared here are
      // inferred from the schema tree.
      defaultMappings: [
        {
          rootPath: '',
          target: {
            mode: 'owned',
            entity: {
              apiSlug: 'shopify_orders',
              singular: 'Shopify Order',
              plural: 'Shopify Orders',
              primaryDisplayField: 'name',
            },
          },
        },
        {
          rootPath: 'customer',
          relationshipFieldKey: 'customer',
          target: {
            mode: 'contributing',
            entityKind: 'contact',
            identity: {
              kind: 'matchField',
              connectorFieldKey: 'customer.email',
              targetFieldId: 'email',
              normalize: 'email',
            },
          },
        },
        {
          rootPath: 'line_items[]',
          relationshipFieldKey: 'lineItems',
          target: {
            mode: 'owned',
            entity: {
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
          target: {
            mode: 'owned',
            entity: {
              apiSlug: 'shopify_products',
              singular: 'Shopify Product',
              plural: 'Shopify Products',
            },
          },
        },
      ],
      // Canonical sample → schema preview + dry-run before the first live fetch.
      exampleRecord: {
        id: 'gid://shopify/Order/1234567890',
        name: '#1001',
        total_price: '49.99',
        financial_status: 'paid',
        customer: { email: 'jane@example.com', first_name: 'Jane' },
        line_items: [{ sku: 'TSHIRT-RED-M', product_id: 'gid://shopify/Product/987654321' }],
      },
    },
  ],
  execute: shopifyCoreSync,
})
