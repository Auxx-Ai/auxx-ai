// packages/lib/src/providers/imap/imap-get-message-list.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { MessageListResult } from '../integration-provider.interface'
import { ImapClientProvider } from './imap-client-provider'
import { ImapSyncService } from './imap-sync-service'
import type { ImapCredentialData } from './types'
import { createSyncCursor } from './utils/create-sync-cursor'

const logger = createScopedLogger('imap-message-list')

interface GetMessageListsArgs {
  credentials: ImapCredentialData
  integrationId: string
  organizationId: string
  since?: Date
}

export class ImapGetMessageListService {
  private clientProvider = new ImapClientProvider()
  private syncService = new ImapSyncService()

  /** Discover new message UIDs per folder (Phase 1 of two-phase sync) */
  async getMessageLists(args: GetMessageListsArgs): Promise<MessageListResult[]> {
    const { credentials, integrationId, organizationId } = args
    const results: MessageListResult[] = []

    // Get enabled labels/folders for this integration
    const labels = await db
      .select()
      .from(schema.Label)
      .where(
        and(
          eq(schema.Label.integrationId, integrationId),
          eq(schema.Label.organizationId, organizationId)
        )
      )

    if (labels.length === 0) {
      logger.info('No labels found for IMAP integration, skipping list-fetch', { integrationId })
      return results
    }

    const client = await this.clientProvider.getClient(credentials)

    try {
      for (const label of labels) {
        if (!label.externalId) continue

        const folderPath = label.externalId
        let lock

        try {
          lock = await client.getMailboxLock(folderPath)

          const mailbox = client.mailbox
          if (!mailbox) continue

          const syncResult = await this.syncService.syncFolder(
            client,
            mailbox,
            label.providerCursor
          )

          // Skip if nothing changed
          if (syncResult.newUids.length === 0 && syncResult.deletedUids.length === 0) {
            continue
          }

          const nextCursor = createSyncCursor(syncResult.mailboxState)

          const messageIds = syncResult.newUids.map((uid) => `${folderPath}:${uid}`)
          const deletedMessageIds = syncResult.deletedUids.map((uid) => `${folderPath}:${uid}`)

          results.push({
            messageIds,
            deletedMessageIds,
            previousCursor: label.providerCursor,
            nextCursor,
            labelId: label.id,
          })
        } catch (error) {
          logger.error(`Error syncing IMAP folder ${folderPath}`, {
            error: error instanceof Error ? error.message : String(error),
            integrationId,
          })
          // Continue with other folders
        } finally {
          if (lock) lock.release()
        }
      }
    } finally {
      await this.clientProvider.closeClient(client)
    }

    return results
  }
}
