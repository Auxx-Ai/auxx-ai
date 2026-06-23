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
export type { BackfillSliceJobData, DataConnectorSyncJobData } from './data-connector-queue'
// Queue + scheduler
export {
  BACKFILL_SLICE_JOB,
  enqueueBackfillSlice,
  enqueueConnectorSync,
} from './data-connector-queue'
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
export {
  backfillProvisionedFieldRefs,
  provisionConnectorMappings,
  provisionTarget,
} from './provisioning'
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
// Watermark comparison (steady mode, G2)
export { isNumericWatermark, maxWatermark } from './watermark'
