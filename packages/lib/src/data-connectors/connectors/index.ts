// packages/lib/src/data-connectors/connectors/index.ts

export { type AppConnectorContext, appConnectorAdapter } from './app-connector-adapter'
export { fixtureConnector } from './fixture'
export { genericRestConnector } from './generic-rest'
export { connectorFor } from './registry'
export type {
  ConnectorDefaultMapping,
  ConnectorEntityDecl,
  ConnectorFetchArgs,
  ConnectorFieldCapabilities,
  ConnectorFieldDecl,
  ConnectorRecord,
  ConnectorStreamDecl,
  ConnectorStreamState,
  DataConnectorConfig,
  DataConnectorDefinition,
  DecryptedCredential,
  FetchResult,
  PaginationSpec,
  StreamRequestConfig,
} from './types'
