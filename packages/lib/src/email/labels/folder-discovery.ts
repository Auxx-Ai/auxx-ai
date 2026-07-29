// packages/lib/src/email/labels/folder-discovery.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, notInArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from './guard'
import type { DiscoveredFolder } from './types'

const logger = createScopedLogger('labels')

/**
 * Persist the folder list a provider just reported for one integration.
 *
 * Replaces `FolderDiscoveryService` — the class held no state, so it was a
 * namespace around a single method (module guide §2). Called from the polling
 * `messageListFetchJob` and from the settings `discoverFolders` procedure, which
 * is why it takes `db` rather than reaching for the module-level pool: the job
 * and the router hand it different connections.
 *
 * Three writes, now in **one transaction** instead of three sequential per-row
 * loops — a failure between the upsert and the pending-removal sweep used to
 * leave folders both freshly-renamed and marked for deletion.
 *
 * The sweep itself is a single `notInArray` statement. It previously read *every*
 * label for the integration and issued one `UPDATE` per non-discovered row, which
 * is O(folders) roundtrips for a set that is usually empty.
 *
 * `PENDING_REMOVAL` is deliberately a marker rather than a delete: messages have
 * to be cleaned up before the folder row can go, so removal is deferred.
 */
export async function discoverAndUpsertFolders(
  db: Database,
  organizationId: string,
  params: { integrationId: string; provider: string; discoveredFolders: DiscoveredFolder[] }
): Promise<Result<void, Error>> {
  const { integrationId, provider, discoveredFolders } = params

  return guard(
    async () => {
      // An empty provider response is treated as "we learned nothing", NOT as
      // "the mailbox has no folders". Without this the sweep below would mark
      // every folder in the integration PENDING_REMOVAL and disable sync for the
      // whole channel on one bad API call.
      if (discoveredFolders.length === 0) return

      const now = new Date()
      const discoveredExternalIds = discoveredFolders.map((folder) => folder.externalId)

      const sweptCount = await db.transaction(async (tx) => {
        // 1. Upsert each discovered folder. Per-row because each carries its own
        //    SET payload; the unique index is (labelId, organizationId, integrationId).
        for (const folder of discoveredFolders) {
          await tx
            .insert(schema.Label)
            .values({
              labelId: folder.externalId,
              name: folder.name,
              integrationId,
              integrationType: provider,
              organizationId,
              type: 'system',
              enabled: true,
              isVisible: true,
              isSentBox: folder.isSentBox,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                schema.Label.labelId,
                schema.Label.organizationId,
                schema.Label.integrationId,
              ],
              set: {
                name: folder.name,
                isSentBox: folder.isSentBox,
                integrationType: provider,
                // Clear a previous PENDING_REMOVAL: the folder is back.
                pendingAction: null,
                updatedAt: now,
              },
            })
        }

        // 2. Anything we hold for this integration that the provider no longer
        //    reports is marked for removal and stops importing messages.
        const swept = await tx
          .update(schema.Label)
          .set({ pendingAction: 'PENDING_REMOVAL', enabled: false, updatedAt: now })
          .where(
            and(
              eq(schema.Label.integrationId, integrationId),
              eq(schema.Label.organizationId, organizationId),
              notInArray(schema.Label.labelId, discoveredExternalIds)
            )
          )
          .returning({ id: schema.Label.id })

        // 3. Resolve parentLabelId for nested folders (IMAP hierarchies). One
        //    read of the integration's labelId→id map replaces the two per-folder
        //    SELECTs the old loop issued.
        const rows = await tx
          .select({ id: schema.Label.id, labelId: schema.Label.labelId })
          .from(schema.Label)
          .where(
            and(
              eq(schema.Label.integrationId, integrationId),
              eq(schema.Label.organizationId, organizationId)
            )
          )
        const idByExternalId = new Map(rows.map((row) => [row.labelId, row.id]))

        for (const folder of discoveredFolders) {
          if (!folder.parentExternalId) continue

          const childId = idByExternalId.get(folder.externalId)
          const parentId = idByExternalId.get(folder.parentExternalId)
          if (!childId || !parentId) continue

          await tx
            .update(schema.Label)
            .set({ parentLabelId: parentId, updatedAt: now })
            .where(eq(schema.Label.id, childId))
        }

        return swept.length
      })

      logger.info('Folder discovery complete', {
        integrationId,
        organizationId,
        discovered: discoveredFolders.length,
        pendingRemoval: sweptCount,
      })
    },
    'Error discovering folders',
    { integrationId, provider }
  )
}
