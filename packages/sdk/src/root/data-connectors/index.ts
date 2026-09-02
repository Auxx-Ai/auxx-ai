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
 * Register it on the app export: `app.dataConnectors = [shopifyCoreDataConnector]`
 * — one connector per app.
 */

export { defineDataConnector } from './define-data-connector.js'
export type {
  ConnectorConnection,
  ConnectorConnectionField,
  ConnectorContributingFieldSourceOnly,
  ConnectorContributingFieldToAppField,
  ConnectorContributingFieldToTarget,
  ConnectorContributingMappingField,
  ConnectorExecute,
  ConnectorExecuteArgs,
  ConnectorFetchResult,
  ConnectorMapping,
  ConnectorOwnedMappingField,
  ConnectorRecord,
  ConnectorStreamDecl,
  ConnectorStreamState,
  ContributingConnectorMapping,
  DataConnectorDefinition,
  FieldMergeStrategy,
  OwnedConnectorMapping,
} from './types.js'
