// packages/lib/src/knowledge-sources/connectors/index.ts

import { manualConnector } from './manual'
import type { SourceConnector } from './types'

export { manualConnector } from './manual'
export type { SourceConnector } from './types'

const connectors: Record<string, SourceConnector> = {
  manual: manualConnector,
  // website (Phase 2), shopify (Phase 5), file (Phase 6), notion/confluence/zendesk (Phase 7)
}

/** Resolve the connector for a source type, or throw if unsupported. */
export function connectorFor(type: string): SourceConnector {
  const connector = connectors[type]
  if (!connector) throw new Error(`No connector registered for source type '${type}'`)
  return connector
}
