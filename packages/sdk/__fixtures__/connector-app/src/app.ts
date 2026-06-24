// packages/sdk/__fixtures__/connector-app/src/app.ts
//
// Fixture exercising the app-connector path: an app that registers a Data
// Connector via `defineDataConnector`. Consumed by
// `src/util/__tests__/compile-and-extract-catalog.test.ts` to pin the
// `catalog.dataConnectors` projection (streams, fields, defaultMappings,
// exampleRecord, requiresConnection, config JSON Schema, configOptionHints).
//
// Unannotated `app` export (NOT `: App`) so the connector literals survive on
// `typeof app`.

import { z } from 'zod/v4'
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
  dataConnectors: [shopifyCoreDataConnector],
}
