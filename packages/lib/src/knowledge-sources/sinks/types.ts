// packages/lib/src/knowledge-sources/sinks/types.ts
// The sink seam: connectors yield surface-agnostic SourceItems; a SourceSink decides
// where each lands (article tree vs dataset doc). See plans/kb/sources/phase-1-spine.md.

import type { Database, schema } from '@auxx/database'

export type KnowledgeSourceRow = typeof schema.KnowledgeSource.$inferSelect
export type KnowledgeBaseRow = typeof schema.KnowledgeBase.$inferSelect

/** One unit of ingested content, produced by a connector, consumed by a sink. */
export interface SourceItem {
  /** Stable, normalized, unique-per-source id (URL / GID / file key / manual key). */
  externalId: string
  title: string
  markdown: string
  /** Optional path (e.g. URL pathname) — drives folder-by-path in the article sink. */
  path?: string
}

export interface SyncCtx {
  db: Database
  orgId: string
  source: KnowledgeSourceRow
  /** The source's owned (hidden) KB — articles home + embed here. */
  kb: KnowledgeBaseRow
  /** User-facing KBs this source is linked into — new/updated items fan out to these. */
  linkedKbIds: string[]
}

export interface SourceSink {
  upsertItem(ctx: SyncCtx, item: SourceItem): Promise<void>
  archiveItem(ctx: SyncCtx, externalId: string): Promise<void>
  /** Existing items for orphan reconciliation — content items only, no structural folders. */
  listExisting(ctx: SyncCtx): Promise<{ externalId: string; contentHash: string }[]>
  /** Optional post-pass: propagate the synced tree into any linked user-facing KBs. */
  reconcileLinks?(ctx: SyncCtx): Promise<void>
}
