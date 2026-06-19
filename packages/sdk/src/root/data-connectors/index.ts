// packages/sdk/src/root/data-connectors/index.ts

/**
 * @auxx/sdk/data-connectors — author surface for app-declared Data Connectors.
 *
 * A Data Connector declares where structured records come from and how they map
 * onto the platform's entity model. The app fetches + normalizes to a source
 * schema; the platform validates, maps, and writes entities. The app never sees
 * target defs or gets entity write access.
 *
 * Usage:
 * ```ts
 * import { defineDataConnector } from '@auxx/sdk/data-connectors'
 * import { z } from '@auxx/sdk/tools'
 * import { shopifyCoreSync } from './shopify-core.connector.server'
 *
 * export const shopifyCoreDataConnector = defineDataConnector({ ... })
 * ```
 *
 * Register it on the app export: `app.dataConnectors = [shopifyCoreDataConnector]`.
 */

export { defineDataConnector } from './define-data-connector.js'
export type {
  ConnectorConnection,
  ConnectorDefaultMapping,
  ConnectorEntityDecl,
  ConnectorExecute,
  ConnectorExecuteArgs,
  ConnectorFetchResult,
  ConnectorFieldCapabilities,
  ConnectorFieldDecl,
  ConnectorRecord,
  ConnectorStreamDecl,
  ConnectorStreamState,
  DataConnectorDefinition,
} from './types.js'
