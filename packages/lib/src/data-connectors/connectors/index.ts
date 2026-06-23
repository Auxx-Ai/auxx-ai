// packages/lib/src/data-connectors/connectors/index.ts

export { type AppConnectorContext, appConnectorAdapter } from './app-connector-adapter'
export { fixtureConnector } from './fixture'
export { genericRestConnector } from './generic-rest'
export { connectorFor } from './registry'
export type {
  ConnectorCheckpoint,
  ConnectorDefaultMapping,
  ConnectorEntityDecl,
  ConnectorFetchArgs,
  ConnectorFieldCapabilities,
  ConnectorFieldDecl,
  ConnectorRecord,
  ConnectorStreamDecl,
  ConnectorStreamState,
  ConnectorYield,
  DataConnectorConfig,
  DataConnectorDefinition,
  DecryptedCredential,
  FetchResult,
  PaginationSpec,
  StreamIncrementalConfig,
  StreamRequestConfig,
} from './types'
export { ConnectorRateLimitError, isConnectorCheckpoint } from './types'
