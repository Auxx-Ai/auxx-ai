// packages/lib/src/knowledge-sources/index.ts
// Knowledge Sources — ingest external content into a KB. See plans/kb/sources/.

export type { CrawlConnector, ListConnector, SourceConnector } from './connectors'
export { connectorFor, manualConnector, websiteConnector } from './connectors'
export type { CrawlOpts, CrawlPage, CrawlProvider, MappedLink, SitemapNode } from './crawl'
export { buildTreeFromPaths, getCrawlProvider, normalizeUrl, resetCrawlProvider } from './crawl'
export { runSourceSync } from './run-source-sync'
export { articleSink, sinkForSurface } from './sinks'
export type {
  KnowledgeBaseRow,
  KnowledgeSourceRow,
  SourceItem,
  SourceSink,
  SyncCtx,
} from './sinks/types'
export {
  listSourceLinks,
  unlinkSourceArticleFromKb,
  unlinkSourceFromKb,
} from './source-links'
export {
  reconcileSourceSchedulers,
  removeSourceScheduler,
  syncSourceScheduler,
} from './source-scheduler'
export type { CreateSourceInput } from './source-service'
export {
  createSource,
  deleteSource,
  getSource,
  listSources,
  pauseSource,
  resumeSource,
  updateSource,
} from './source-service'
export type { SourceSyncJobData } from './source-sync-queue'
export { enqueueSourceSync } from './source-sync-queue'
