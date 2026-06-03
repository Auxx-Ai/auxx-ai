// packages/lib/src/knowledge-sources/connectors/index.ts

import { manualConnector } from './manual'
import type { SourceConnector } from './types'
import { websiteConnector } from './website'

export { manualConnector } from './manual'
export type { CrawlConnector, ListConnector, SourceConnector } from './types'
export { websiteConnector } from './website'

const connectors: Record<string, SourceConnector> = {
  manual: manualConnector,
  website: websiteConnector,
  // shopify (Phase 5), file (Phase 6), notion/confluence/zendesk (Phase 7)
}

/** Resolve the connector for a source type, or throw if unsupported. */
export function connectorFor(type: string): SourceConnector {
  const connector = connectors[type]
  if (!connector) throw new Error(`No connector registered for source type '${type}'`)
  return connector
}
