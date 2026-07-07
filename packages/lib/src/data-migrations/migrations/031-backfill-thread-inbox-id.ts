// packages/lib/src/data-migrations/migrations/031-backfill-thread-inbox-id.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { inArray, isNull } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-031')

const CHUNK = 500

/**
 * Backfill `Thread.inboxId` from the `InboxIntegration` mapping so `inboxId`
 * stops being a visibility class (mail-permissions Phase 0). Every mail
 * integration maps to exactly one inbox (unique index on
 * `InboxIntegration.integrationId`), so the join is deterministic.
 *
 * Residual null-inbox threads — an integration with no `InboxIntegration` row,
 * e.g. an unmapped chat integration — are left null and logged per integration
 * for the prod checkpoint (they resolve to admins + assignee under the
 * evaluator). Idempotent: only touches `inboxId IS NULL` rows.
 */
export const migration031BackfillThreadInboxId: DataMigrationDef = {
  id: '031-backfill-thread-inbox-id',
  description: 'Backfill Thread.inboxId from InboxIntegration by integrationId',
  async run(db: Database): Promise<void> {
    const links = await db
      .select({
        integrationId: schema.InboxIntegration.integrationId,
        inboxId: schema.InboxIntegration.inboxId,
      })
      .from(schema.InboxIntegration)
    const inboxByIntegration = new Map(links.map((l) => [l.integrationId, l.inboxId]))

    const nullThreads = await db
      .select({ id: schema.Thread.id, integrationId: schema.Thread.integrationId })
      .from(schema.Thread)
      .where(isNull(schema.Thread.inboxId))

    if (nullThreads.length === 0) {
      logger.info('No null-inbox threads to backfill')
      return
    }

    // Group thread ids by their resolved inbox so we update in batched IN-lists.
    const threadsByInbox = new Map<string, string[]>()
    const unresolvedByIntegration = new Map<string, number>()
    for (const t of nullThreads) {
      const inboxId = inboxByIntegration.get(t.integrationId)
      if (!inboxId) {
        unresolvedByIntegration.set(
          t.integrationId,
          (unresolvedByIntegration.get(t.integrationId) ?? 0) + 1
        )
        continue
      }
      const arr = threadsByInbox.get(inboxId) ?? []
      arr.push(t.id)
      threadsByInbox.set(inboxId, arr)
    }

    let updated = 0
    for (const [inboxId, threadIds] of threadsByInbox) {
      for (let i = 0; i < threadIds.length; i += CHUNK) {
        const chunk = threadIds.slice(i, i + CHUNK)
        await db.update(schema.Thread).set({ inboxId }).where(inArray(schema.Thread.id, chunk))
        updated += chunk.length
      }
    }

    logger.info('Backfilled Thread.inboxId', {
      updated,
      unresolved: nullThreads.length - updated,
    })

    if (unresolvedByIntegration.size > 0) {
      logger.warn('Threads left with null inboxId (integration has no InboxIntegration row)', {
        integrations: Array.from(unresolvedByIntegration, ([integrationId, count]) => ({
          integrationId,
          count,
        })),
      })
    }
  },
}
