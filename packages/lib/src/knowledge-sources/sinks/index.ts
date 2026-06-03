// packages/lib/src/knowledge-sources/sinks/index.ts

import { articleSink } from './article-sink'
import type { KnowledgeSourceRow, SourceSink } from './types'

export { articleSink } from './article-sink'
export type { KnowledgeBaseRow, KnowledgeSourceRow, SourceItem, SourceSink, SyncCtx } from './types'

/**
 * Pick the sink for a source's surface. `publishable` (default) → the article sink;
 * `ai-only` → the dataset sink, which ships in Phase 4 (rejected until then).
 */
export function sinkForSurface(source: KnowledgeSourceRow): SourceSink {
  if (source.surface === 'ai-only') {
    throw new Error('AI-only dataset sink is not implemented yet (Phase 4)')
  }
  return articleSink
}
