// packages/sdk/__fixtures__/connector-app/src/app.ts
//
// Fixture exercising the app-connector + app-entities path: an app that owns
// entities via `defineEntity` and registers a Data Connector via
// `defineDataConnector` that maps onto them. Consumed by
// `src/util/__tests__/compile-and-extract-catalog-connectors.test.ts` to pin
// the `catalog.entities` and `catalog.dataConnectors` projections (streams,
// mappings, exampleRecord, requiresConnection, config JSON Schema,
// configOptionHints).
//
// Unannotated `app` export (NOT `: App`) so the connector + entity literals
// survive on `typeof app`.

import { defineFields } from '@auxx/sdk/fields'
import { z } from 'zod/v4'
import { lineItems, orders, products } from './entities'
import listOptions from './list-options.tool.server'
import { shopifyCoreDataConnector } from './shopify-core.connector'

export const app = {
  // A resolver tool backing the connector's `configOptions.collection` picker —
  // its id must match `configOptions.collection.dynamicSelect.optionsFrom`.
  tools: [
    {
      id: 'list_shopify_collections',
      name: 'List Shopify collections',
      description: 'Internal — lists collections to back a connector config dropdown.',
      inputs: z.object({}),
      outputs: z.object({
        collections: z.array(z.object({ handle: z.string() })),
      }),
      execute: listOptions,
    },
  ],
  // A manifest field on the platform `contact` — filled by the connector's
  // `customer` mapping's `connectionFields` (from Shopify's connection label),
  // never by the source record.
  fields: defineFields([
    {
      key: 'storeDomain',
      type: 'TEXT',
      targetEntity: 'contact',
      scope: 'connection',
      name: 'Shopify store',
      capabilities: { hidden: true },
    },
  ]),
  entities: [orders, lineItems, products],
  dataConnectors: [shopifyCoreDataConnector],
}
