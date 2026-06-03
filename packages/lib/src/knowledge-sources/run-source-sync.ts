// packages/lib/src/knowledge-sources/run-source-sync.ts
// The sink-agnostic re-sync loop. The orchestrator never branches on surface —
// only `sinkForSurface` does. Idempotent + hash-skipped end to end.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { connectorFor } from './connectors'
import { sinkForSurface } from './sinks'
import type { SyncCtx } from './sinks/types'

const logger = createScopedLogger('run-source-sync')

export async function runSourceSync(
  db: Database,
  organizationId: string,
  sourceId: string
): Promise<void> {
  const source = await db.query.KnowledgeSource.findFirst({
    where: and(
      eq(schema.KnowledgeSource.id, sourceId),
      eq(schema.KnowledgeSource.organizationId, organizationId)
    ),
  })
  if (!source) {
    logger.warn('runSourceSync: source not found', { sourceId })
    return
  }

  // Atomic concurrency guard — a scheduled fire can collide with a manual Sync now
  // (or a still-running slow crawl). Claim the source by flipping to 'syncing' only
  // if it isn't already; if no row comes back, another run holds it → skip. The
  // in-flight run picks up current upstream state anyway.
  const [claimed] = await db
    .update(schema.KnowledgeSource)
    .set({ status: 'syncing', updatedAt: new Date() })
    .where(
      and(eq(schema.KnowledgeSource.id, sourceId), ne(schema.KnowledgeSource.status, 'syncing'))
    )
    .returning({ id: schema.KnowledgeSource.id })
  if (!claimed) {
    logger.info('runSourceSync: source already syncing, skipping', { sourceId })
    return
  }

  try {
    const kb = await db.query.KnowledgeBase.findFirst({
      where: eq(schema.KnowledgeBase.id, source.ownedKnowledgeBaseId),
    })
    if (!kb) throw new Error(`Owned KnowledgeBase ${source.ownedKnowledgeBaseId} not found`)

    // KBs this source is already linked into — new/changed items fan out to each so a
    // linked KB stays in sync without a re-link. Derived from existing linked placements.
    const linkRows = await db
      .selectDistinct({ knowledgeBaseId: schema.ArticlePlacement.knowledgeBaseId })
      .from(schema.ArticlePlacement)
      .where(
        and(
          eq(schema.ArticlePlacement.organizationId, organizationId),
          eq(schema.ArticlePlacement.linkedFromSourceId, sourceId),
          isNotNull(schema.ArticlePlacement.linkedFromSourceId),
          ne(schema.ArticlePlacement.knowledgeBaseId, source.ownedKnowledgeBaseId)
        )
      )
    const linkedKbIds = linkRows.map((r) => r.knowledgeBaseId)

    const ctx: SyncCtx = { db, orgId: organizationId, source, kb, linkedKbIds }
    const connector = connectorFor(source.type)
    const sink = sinkForSurface(source)

    const existing = await sink.listExisting(ctx)
    const seen = new Set<string>()

    if (connector.mode === 'list') {
      // List sources return the whole item set up front.
      const items = await connector.fetchItems(source)
      for (const item of items) {
        seen.add(item.externalId)
        await sink.upsertItem(ctx, item)
      }
    } else {
      // Crawl sources stream items as they're discovered — never buffer a whole site.
      const { externalIds } = await connector.crawl(source, async (item) => {
        seen.add(item.externalId)
        await sink.upsertItem(ctx, item)
      })
      for (const externalId of externalIds) seen.add(externalId)
    }

    // Reconcile orphans against everything seen this run.
    for (const { externalId } of existing) {
      if (!seen.has(externalId)) await sink.archiveItem(ctx, externalId)
    }

    // Propagate the freshly-synced tree into any KBs this source is linked into.
    await sink.reconcileLinks?.(ctx)

    const itemCount = seen.size
    await db
      .update(schema.KnowledgeSource)
      .set({
        status: 'live',
        lastSyncedAt: new Date(),
        itemCount,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.KnowledgeSource.id, sourceId))
    logger.info('runSourceSync: complete', { sourceId, itemCount })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('runSourceSync: failed', { sourceId, error: message })
    await db
      .update(schema.KnowledgeSource)
      .set({ status: 'error', error: message, updatedAt: new Date() })
      .where(eq(schema.KnowledgeSource.id, sourceId))
  }
}
