// packages/lib/src/data-connectors/connectors/index.ts

export { type AppConnectorContext, appConnectorAdapter } from './app-connector-adapter'
export { fixtureConnector } from './fixture'
export { genericRestConnector } from './generic-rest'
export { connectorFor } from './registry'
export {
  createStripeFinancialConnectionsConnector,
  decodeRefreshWatermark,
  encodeRefreshWatermark,
  FC_ACCOUNTS_STREAM,
  FC_TRANSACTIONS_STREAM,
  type FcAccount,
  type FcTransaction,
  type FinancialConnectionsClient,
  type FinancialConnectionsFilters,
  STRIPE_FC_CONNECTOR_TYPE,
  stripeFinancialConnectionsConnector,
  toAccountFields,
  toAccountLabel,
  toBankAccountType,
  toBankStatus,
  toTransactionFields,
} from './stripe-financial-connections'
export type {
  ConnectorCheckpoint,
  ConnectorConnectionField,
  ConnectorContributingMappingField,
  ConnectorFetchArgs,
  ConnectorMapping,
  ConnectorOwnedMappingField,
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
export { ConnectorRateLimitError, isConnectorCheckpoint, PermanentSteerError } from './types'
