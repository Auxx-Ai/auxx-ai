// packages/lib/src/data-connectors/index.ts
// Data Connectors — sync external structured records into the entity system.
// See plans/data-connectors/. Server-only (BullMQ, crypto): never import this
// barrel from client code.

// Connector runtime — the shared definition+credential seam + test-fetch
export type {
  PreparedConnectorFetch,
  SampleConnectorFetchInput,
  SampleConnectorFetchResult,
} from './connector-runtime'
export {
  prepareConnectorFetch,
  resolveConnectorCredential,
  sampleConnectorFetch,
} from './connector-runtime'
export type {
  AppConnectorContext,
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
} from './connectors'
// Connectors + contract
export {
  appConnectorAdapter,
  connectorFor,
  fixtureConnector,
  genericRestConnector,
} from './connectors'
export type { DataConnectorSyncJobData } from './data-connector-queue'
// Queue + scheduler
export { enqueueConnectorSync } from './data-connector-queue'
export {
  reconcileConnectorSchedulers,
  removeConnectorScheduler,
  syncConnectorScheduler,
} from './data-connector-scheduler'
export type { MappedWrite } from './map-record'
// Mapping layer
export { mapRecord } from './map-record'
export type {
  AddMappingInput,
  AddStreamInput,
  CreateConnectorInput,
  DeleteSyncedDataBehavior,
  UpdateConnectorInput,
  UpdateMappingInput,
} from './mutations'
// Mutations + setup (tRPC write surface)
export {
  addMapping,
  addStream,
  createConnector,
  createConnectorFromTemplate,
  deleteConnector,
  removeMapping,
  removeStream,
  setStreamRequestConfig,
  setStreamSchema,
  updateConnector,
  updateMapping,
  updateStream,
} from './mutations'
export type {
  ProvisionFieldSpec,
  ProvisionResult,
  ProvisionTarget,
} from './provisioning'
// Schema provisioning (owned + contributing, 01 §5)
export { provisionConnectorMappings, provisionTarget } from './provisioning'
// Orchestrator + passes
export { handleConnectorDelete, reconcileOrphans } from './reconciliation'
export { resolveRelationships } from './relationship-pass'
export { runDataConnectorSync } from './run-data-connector-sync'
export type {
  DataConnectorItemRow,
  DataConnectorMappingRow,
  DataConnectorRow,
  DataConnectorRunRow,
  DataConnectorStreamRow,
  DecodedMapping,
  LoadedConnector,
  PendingRelation,
  RunCounters,
  StreamWithMappings,
  StreamWithRawMappings,
  UpsertItemInput,
} from './service'
// Service layer
export {
  claimForSync,
  decodeMapping,
  finalizeConnector,
  finalizeRun,
  findItem,
  getConnector,
  listConnectors,
  listItemsForMapping,
  listItemsWithPendingRelations,
  listRuns,
  listStreams,
  loadConnector,
  markItemArchived,
  newRunCounters,
  openRun,
  persistStreamState,
  setItemPendingRelations,
  touchItem,
  upsertItem,
} from './service'
// Sink
export { entitySink } from './sinks/entity-sink'
export type { EntitySink, ProjectedRecord, SyncCtx } from './sinks/types'
// Connector templates (05c) — first-party generic-rest presets
export type {
  ConnectorTemplate,
  ConnectorTemplateStream,
  ConnectorTemplateSummary,
} from './templates'
export { getAllConnectorTemplates, getConnectorTemplateById } from './templates'
// Canonical engine types
export type {
  ConnectorRequestModel,
  DataConnectorType,
  FieldMapping,
  FieldMergeStrategy,
  IdentityNormalize,
  LinkMode,
  OrphanBehavior,
  ScheduledTriggerConfig,
  SyncMode,
  TargetMode,
} from './types'
