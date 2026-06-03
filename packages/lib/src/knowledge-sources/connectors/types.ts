// packages/lib/src/knowledge-sources/connectors/types.ts
// A connector fetches a source's current items. It is sink-agnostic — it never
// touches Article or Document; the sink decides where each item lands. Two modes:
//   - 'list':  return the full item set up front (manual, file).
//   - 'crawl': stream items as they're discovered (website) — never buffers a whole
//              site in memory; the returned externalIds drive orphan reconciliation.

import type { KnowledgeSourceRow, SourceItem } from '../sinks/types'

export interface ListConnector {
  mode: 'list'
  type: string
  fetchItems(source: KnowledgeSourceRow): Promise<SourceItem[]>
}

export interface CrawlConnector {
  mode: 'crawl'
  type: string
  /** Stream each item via `onItem`; resolve with the full externalId list for reconcile. */
  crawl(
    source: KnowledgeSourceRow,
    onItem: (item: SourceItem) => Promise<void>
  ): Promise<{ externalIds: string[] }>
}

export type SourceConnector = ListConnector | CrawlConnector
