// packages/lib/src/knowledge-sources/index.ts
// Knowledge Sources — ingest external content into a KB. See plans/kb/sources/.

export type { SourceConnector } from './connectors'
export { connectorFor, manualConnector } from './connectors'
export { runSourceSync } from './run-source-sync'
export { articleSink, sinkForSurface } from './sinks'
export type {
  KnowledgeBaseRow,
  KnowledgeSourceRow,
  SourceItem,
  SourceSink,
  SyncCtx,
} from './sinks/types'
export type { CreateSourceInput } from './source-service'
export {
  createSource,
  deleteSource,
  getSource,
  listSources,
  updateSource,
} from './source-service'
export type { SourceSyncJobData } from './source-sync-queue'
export { enqueueSourceSync } from './source-sync-queue'
