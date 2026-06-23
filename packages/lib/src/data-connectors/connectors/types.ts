// packages/lib/src/data-connectors/connectors/types.ts
// The connector contract (03 §1). Re-exports the canonical engine types so
// connector implementations import from one place. A connector only fetches +
// normalizes to the source schema — it never writes entities (that is the sink).

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
  ConnectorWebhookState,
  ConnectorYield,
  DataConnectorConfig,
  DataConnectorDefinition,
  DecryptedCredential,
  FetchResult,
  PaginationSpec,
  StreamIncrementalConfig,
  StreamRequestConfig,
  WebhookAction,
  WebhookCapability,
  WebhookRegisterInput,
  WebhookSubscription,
  WebhookUnregisterInput,
} from '../types'
export { ConnectorRateLimitError, isConnectorCheckpoint } from '../types'
