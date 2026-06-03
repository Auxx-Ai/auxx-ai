// packages/lib/src/knowledge-sources/connectors/manual.ts
// The proof connector: items are pasted into the source config verbatim. Exercises
// the whole spine (materialize → tree → re-sync → orphan → detach) with no external dep.

import type { SourceItem } from '../sinks/types'
import type { SourceConnector } from './types'

export const manualConnector: SourceConnector = {
  mode: 'list',
  type: 'manual',
  async fetchItems(source) {
    const items = (source.config as { items?: SourceItem[] })?.items
    return Array.isArray(items) ? items : []
  },
}
