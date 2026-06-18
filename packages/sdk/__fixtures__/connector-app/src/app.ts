// packages/sdk/__fixtures__/connector-app/src/app.ts
//
// Fixture exercising the app-connector path: an app that registers a Data
// Connector via `defineDataConnector`. Consumed by
// `src/util/__tests__/compile-and-extract-catalog.test.ts` to pin the
// `catalog.dataConnectors` projection (streams, fields, defaultMappings,
// exampleRecord, requiresConnection, config JSON Schema).
//
// Unannotated `app` export (NOT `: App`) so the connector literals survive on
// `typeof app`.

import { shopifyCoreDataConnector } from './shopify-core.connector'

export const app = {
  dataConnectors: [shopifyCoreDataConnector],
}
