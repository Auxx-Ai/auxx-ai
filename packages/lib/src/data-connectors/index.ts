// packages/lib/src/data-connectors/index.ts
// Data Connectors — sync external structured records into the entity system.
// See plans/data-connectors/. Server-only (BullMQ, crypto): never import this
// barrel from client code.

// App-catalog → setup materialization (create-sync-flow §3.1, Tier 1)
export { appCatalogStreamSchema, buildSchemaFromFieldPaths } from './app-catalog'
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
// Sliced SyncSource (Step 3b) — DC implementation of the shared-core fetch slice
export type {
  RunConnectorSliceArgs,
  SliceFetch,
  SliceSink,
} from './connector-slice-loop'
export { runConnectorSlice } from './connector-slice-loop'
export type {
  ConnectorSyncSource,
  ConnectorSyncSourceDeps,
  SyncSourceStream,
} from './connector-sync-source'
export { createConnectorStreamSyncSource } from './connector-sync-source'
// Webhook ingress + registration (Step 8)
export { applyWebhookActions, runConnectorWebhook } from './connector-webhook'
export {
  registerConnectorWebhooks,
  unregisterConnectorWebhooks,
} from './connector-webhook-registration'
export type {
  AppConnectorContext,
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
} from './connectors'
// Connectors + contract
export {
  appConnectorAdapter,
  ConnectorRateLimitError,
  connectorFor,
  fixtureConnector,
  genericRestConnector,
  isConnectorCheckpoint,
} from './connectors'
export type {
  BackfillSliceJobData,
  ConnectorWebhookJobData,
  DataConnectorSyncJobData,
} from './data-connector-queue'
// Queue + scheduler
export {
  BACKFILL_SLICE_JOB,
  CONNECTOR_WEBHOOK_JOB,
  enqueueBackfillSlice,
  enqueueConnectorSync,
  enqueueConnectorWebhook,
} from './data-connector-queue'
export {
  reconcileConnectorSchedulers,
  removeConnectorScheduler,
  syncConnectorScheduler,
  syncConnectorSweepScheduler,
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
  createConnectorFromAppCatalog,
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
export {
  backfillProvisionedFieldRefs,
  provisionConnectorMappings,
  provisionTarget,
} from './provisioning'
// Orchestrator + passes
export { archiveExternalId, handleConnectorDelete, reconcileOrphans } from './reconciliation'
export { resolveRelationships } from './relationship-pass'
export { runDataConnectorSync } from './run-data-connector-sync'
// Status-line schedule derivation (Step 9 §3.3)
export type { ConnectorScheduleInfo, DeriveScheduleInput } from './schedule-info'
export { deriveConnectorScheduleInfo } from './schedule-info'
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
  countConnectorItems,
  decodeMapping,
  decrementConnectorBackfillLatch,
  finalizeConnector,
  finalizeRun,
  findItem,
  getConnector,
  initConnectorBackfillLatch,
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
  setRunRateLimited,
  touchItem,
  upsertItem,
} from './service'
// Sink
export { entitySink } from './sinks/entity-sink'
export type { EntitySink, ProjectedRecord, SyncCtx } from './sinks/types'
// Sliced backfill orchestration (Step 4) — worker-facing continuation engine
export {
  runBackfillSlice,
  SLICE_BUDGET,
  SLICE_LOCK_DURATION_MS,
  STALE_RUN_MS,
  startConnectorSync,
  sweepStaleConnectorRuns,
} from './slice-orchestrator'
// Tier 2 mapping suggester (create-sync-flow §3.2) — heuristic source→field proposals
export type { SourceLeaf } from './suggest-mappings'
export { collectSchemaLeaves, suggestFieldMappings } from './suggest-mappings'
// Sync-core adapters (Step 3) — DC implementations of the shared seams
export {
  applySyncStateToStream,
  createConnectorRunLedger,
  createStreamSyncStateStore,
  syncStateFromStream,
} from './sync-core-adapters'
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
  ConnectorWebhookState,
  DataConnectorType,
  FieldMapping,
  FieldMergeStrategy,
  IdentityNormalize,
  LinkMode,
  OrphanBehavior,
  ScheduledTriggerConfig,
  SyncMode,
  TargetMode,
  WebhookAction,
  WebhookCapability,
  WebhookSubscription,
} from './types'
// Watermark comparison (steady mode, G2)
export { isNumericWatermark, maxWatermark } from './watermark'
// Webhook capability drivers + resolver (Step 8)
export {
  fixtureWebhookCapability,
  resolveWebhookCapability,
  shopifyWebhookCapability,
  stripeWebhookCapability,
} from './webhooks'
