// packages/lib/src/knowledge-sources/run-source-sync.ts
// The sink-agnostic re-sync loop. The orchestrator never branches on surface —
// only `sinkForSurface` does. Idempotent + hash-skipped end to end.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
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

  // Concurrency guard — a scheduled fire (Phase 3) can collide with a manual
  // Sync now. The in-flight run picks up current upstream state anyway.
  if (source.status === 'syncing') {
    logger.info('runSourceSync: source already syncing, skipping', { sourceId })
    return
  }

  await db
    .update(schema.KnowledgeSource)
    .set({ status: 'syncing', updatedAt: new Date() })
    .where(eq(schema.KnowledgeSource.id, sourceId))

  try {
    const kb = await db.query.KnowledgeBase.findFirst({
      where: eq(schema.KnowledgeBase.id, source.targetKnowledgeBaseId),
    })
    if (!kb) throw new Error(`Target KnowledgeBase ${source.targetKnowledgeBaseId} not found`)

    const ctx: SyncCtx = { db, orgId: organizationId, source, kb }
    const connector = connectorFor(source.type)
    const sink = sinkForSurface(source)

    const items = await connector.fetchItems(source)
    const existing = await sink.listExisting(ctx)
    const seen = new Set<string>()

    for (const item of items) {
      seen.add(item.externalId)
      await sink.upsertItem(ctx, item)
    }
    for (const { externalId } of existing) {
      if (!seen.has(externalId)) await sink.archiveItem(ctx, externalId)
    }

    await db
      .update(schema.KnowledgeSource)
      .set({
        status: 'live',
        lastSyncedAt: new Date(),
        itemCount: items.length,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.KnowledgeSource.id, sourceId))
    logger.info('runSourceSync: complete', { sourceId, itemCount: items.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('runSourceSync: failed', { sourceId, error: message })
    await db
      .update(schema.KnowledgeSource)
      .set({ status: 'error', error: message, updatedAt: new Date() })
      .where(eq(schema.KnowledgeSource.id, sourceId))
  }
}
