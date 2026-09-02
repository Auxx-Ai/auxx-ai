// packages/sdk/__fixtures__/connector-app/src/shopify-core.connector.ts
//
// The Shopify Core data connector — declares an `order` stream's fan-out: the
// order root maps onto the owned `orders` entity, `customer` contributes to
// the platform `contact` (matched on email, `storeDomain` filled from
// connection metadata), `line_items[]` maps onto the owned `line_items`
// entity, and `line_items[].product_id` is a reference-only edge onto the
// owned `products` entity. The platform validates + maps + writes — this app
// only declares the shape + ships the `execute` fetch handler.
//
// See docs/app-fields-and-entities-guide.md.

import { defineDataConnector } from '@auxx/sdk/data-connectors'
import { z } from 'zod/v4'
import shopifyCoreSync from './shopify-core.connector.server'

export const shopifyCoreDataConnector = defineDataConnector({
  id: 'shopify.core',
  label: 'Shopify Core Data',
  description: 'Sync orders and customers from Shopify.',
  requiresConnection: true,
  iconKey: 'shopping-bag',
  webhookTrigger: { triggerId: 'shopify.shopify-trigger' },
  config: z.object({
    includeDraftProducts: z.boolean().default(false),
    collection: z.string().optional(),
  }),
  // `collection` renders as a dropdown backed by the `list_shopify_collections`
  // tool (must be a tool in this app — validated at extraction).
  configOptions: {
    collection: {
      kind: 'dynamic-select',
      dynamicSelect: {
        optionsFrom: 'list_shopify_collections',
        itemsPath: 'collections',
        valuePath: 'handle',
        labelTemplate: '{handle}',
      },
    },
  },
  streams: [
    {
      key: 'order',
      webhookTrigger: { filter: { topic: 'orders/updated' }, paths: ['resourceId'] },
      mappings: [
        {
          // Root record — owned `orders`. Each field's `key` names a field
          // already declared on the entity; type/name/options/identity are
          // inherited from there.
          rootPath: '',
          target: { entityKey: 'orders' },
          fields: [
            { key: 'shopifyId', sourcePath: 'id' },
            { key: 'name', sourcePath: 'name' },
            { key: 'totalPrice', sourcePath: 'total_price' },
            { key: 'financialStatus', sourcePath: 'financial_status' },
          ],
        },
        {
          // Embedded customer — contributes to the platform `contact`. Matched
          // on email (secondary key); `storeDomain` filled from connection
          // metadata (the only synthetic write channel).
          rootPath: 'customer',
          relationshipFieldKey: 'customer',
          target: { entityKind: 'contact' },
          fields: [
            {
              sourcePath: 'email',
              target: 'primary_email',
              match: true,
              mergeStrategy: 'fill_blank',
            },
            { sourcePath: 'first_name', target: 'first_name' },
          ],
          connectionFields: [{ appField: 'storeDomain', from: 'label' }],
        },
        {
          // Embedded line items — owned `line_items`, linked via the
          // `lineItems` RELATIONSHIP field declared on `orders`.
          rootPath: 'line_items[]',
          relationshipFieldKey: 'lineItems',
          target: { entityKey: 'line_items' },
          fields: [
            { key: 'shopifyId', sourcePath: 'id' },
            { key: 'sku', sourcePath: 'sku' },
          ],
        },
        {
          // Id-only reference — links each line item's `product` RELATIONSHIP
          // field to the owned `products` entity. No fields: purely a link.
          rootPath: 'line_items[].product_id',
          linkMode: 'reference',
          relationshipFieldKey: 'product',
          target: { entityKey: 'products' },
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
