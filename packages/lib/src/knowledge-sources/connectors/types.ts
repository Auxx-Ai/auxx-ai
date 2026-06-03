// packages/lib/src/knowledge-sources/connectors/types.ts
// A connector fetches a source's current items. It is sink-agnostic — it never
// touches Article or Document; the sink decides where each item lands.

import type { KnowledgeSourceRow, SourceItem } from '../sinks/types'

export interface SourceConnector {
  type: string
  fetchItems(source: KnowledgeSourceRow): Promise<SourceItem[]>
}
