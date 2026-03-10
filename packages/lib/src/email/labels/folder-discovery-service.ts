// packages/lib/src/email/labels/folder-discovery-service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'

const logger = createScopedLogger('folder-discovery')

export interface DiscoveredFolder {
  externalId: string
  name: string
  isSentBox: boolean
  parentExternalId: string | null
}

/**
 * Discovers folders from a provider and upserts them into the Label table.
 * Marks folders not found on the server as PENDING_REMOVAL + disabled.
 * Resolves parentLabelId for nested folder hierarchies.
 */
export class FolderDiscoveryService {
  async discoverAndUpsert(args: {
    integrationId: string
    organizationId: string
    provider: string
    discoveredFolders: DiscoveredFolder[]
  }): Promise<void> {
    const { integrationId, organizationId, provider, discoveredFolders } = args
    const now = new Date()

    if (discoveredFolders.length === 0) return

    // 1. Upsert each discovered folder (on conflict by labelId+org+integration)
    for (const folder of discoveredFolders) {
      await db
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
          target: [schema.Label.labelId, schema.Label.organizationId, schema.Label.integrationId],
          set: {
            name: folder.name,
            isSentBox: folder.isSentBox,
            integrationType: provider,
            pendingAction: null,
            updatedAt: now,
          },
        })
    }

    // 2. Mark folders not in discovered set as PENDING_REMOVAL + disabled
    const discoveredExternalIds = discoveredFolders.map((f) => f.externalId)
    const allLabels = await db
      .select()
      .from(schema.Label)
      .where(
        and(
          eq(schema.Label.integrationId, integrationId),
          eq(schema.Label.organizationId, organizationId)
        )
      )

    for (const label of allLabels) {
      if (!discoveredExternalIds.includes(label.labelId)) {
        await db
          .update(schema.Label)
          .set({ pendingAction: 'PENDING_REMOVAL', enabled: false, updatedAt: now })
          .where(eq(schema.Label.id, label.id))
      }
    }

    // 3. Resolve parentLabelId for nested folders
    for (const folder of discoveredFolders) {
      if (!folder.parentExternalId) continue

      const [child] = await db
        .select({ id: schema.Label.id })
        .from(schema.Label)
        .where(
          and(
            eq(schema.Label.labelId, folder.externalId),
            eq(schema.Label.integrationId, integrationId)
          )
        )
        .limit(1)

      const [parent] = await db
        .select({ id: schema.Label.id })
        .from(schema.Label)
        .where(
          and(
            eq(schema.Label.labelId, folder.parentExternalId),
            eq(schema.Label.integrationId, integrationId)
          )
        )
        .limit(1)

      if (child && parent) {
        await db
          .update(schema.Label)
          .set({ parentLabelId: parent.id, updatedAt: now })
          .where(eq(schema.Label.id, child.id))
      }
    }

    logger.info('Folder discovery complete', {
      integrationId,
      discovered: discoveredFolders.length,
      total: allLabels.length,
    })
  }
}
