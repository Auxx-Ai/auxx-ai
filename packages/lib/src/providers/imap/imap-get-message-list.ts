// packages/lib/src/providers/imap/imap-get-message-list.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import { and, eq, isNull } from 'drizzle-orm'
import type { MessageListResult } from '../integration-provider.interface'
import { ImapClientProvider } from './imap-client-provider'
import { ImapSyncService } from './imap-sync-service'
import type { ImapCredentialData, ImapFolderCheckpoint } from './types'
import {
  IMAP_IMPORT_BATCH_SIZE,
  MAX_CONSECUTIVE_EMPTY_WINDOWS,
  MAX_TOTAL_EMPTY_WINDOWS,
  UID_SCAN_WINDOW,
} from './types'
import { createSyncCursor } from './utils/create-sync-cursor'
import { extractMailboxState } from './utils/extract-mailbox-state'

const logger = createScopedLogger('imap-message-list')

interface GetMessageListsArgs {
  credentials: ImapCredentialData
  integrationId: string
  organizationId: string
  since?: Date
}

/** Result from windowed full-sync listing for a single folder */
export interface ImapWindowedListResult {
  /** Label DB id */
  labelId: string
  /** Folder path */
  folderPath: string
  /** Import batches with explicit externalIds */
  batches: string[][]
  /** Updated checkpoint to persist */
  checkpoint: ImapFolderCheckpoint
  /** Whether scanning is complete for the entire folder */
  folderScanComplete: boolean
}

export class ImapGetMessageListService {
  private clientProvider = new ImapClientProvider()
  private syncService = new ImapSyncService()

  /**
   * Discover new message UIDs per folder (Phase 1 of two-phase sync).
   * For incremental sync (cursor exists), returns standard MessageListResult.
   * Full sync folders are handled separately via getWindowedFullSyncResults().
   */
  async getMessageLists(args: GetMessageListsArgs): Promise<MessageListResult[]> {
    const { credentials, integrationId, organizationId } = args
    const results: MessageListResult[] = []

    const labels = await this.getEnabledLabels(integrationId, organizationId)

    if (labels.length === 0) {
      logger.info('No labels found for IMAP integration, skipping list-fetch', { integrationId })
      return results
    }

    // Only process labels WITH a committed cursor (incremental sync)
    const incrementalLabels = labels.filter((l) => l.providerCursor !== null)

    if (incrementalLabels.length === 0) {
      return results
    }

    const client = await this.clientProvider.getClient(credentials)

    try {
      for (const label of incrementalLabels) {
        if (!label.labelId) continue

        const folderPath = label.labelId
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
        } finally {
          if (lock) lock.release()
        }
      }
    } finally {
      await this.clientProvider.closeClient(client)
    }

    return results
  }

  /**
   * Windowed full-sync: scan one UID window per folder that needs full sync.
   * Returns batched import work units with checkpoint state.
   * Opens a fresh IMAP connection per call (safe for resumability).
   */
  async getWindowedFullSyncResults(args: GetMessageListsArgs): Promise<ImapWindowedListResult[]> {
    const { credentials, integrationId, organizationId } = args
    const results: ImapWindowedListResult[] = []

    const labels = await this.getEnabledLabels(integrationId, organizationId)

    // Process labels WITHOUT a committed cursor OR with an active checkpoint
    const fullSyncLabels = labels.filter(
      (l) => l.providerCursor === null || l.syncCheckpoint !== null
    )

    if (fullSyncLabels.length === 0) {
      return results
    }

    const client = await this.clientProvider.getClient(credentials)

    try {
      for (const label of fullSyncLabels) {
        if (!label.labelId) continue

        const folderPath = label.labelId
        let lock

        try {
          lock = await client.getMailboxLock(folderPath)

          const mailbox = client.mailbox
          if (!mailbox) continue

          const mailboxState = extractMailboxState(mailbox)

          // Parse or create checkpoint
          let checkpoint = label.syncCheckpoint
            ? (JSON.parse(label.syncCheckpoint) as ImapFolderCheckpoint)
            : null

          // Validate uidValidity if checkpoint exists
          if (checkpoint && checkpoint.uidValidity !== mailboxState.uidValidity) {
            logger.warn('UID validity changed during full sync, restarting folder', {
              folderPath,
              integrationId,
              oldUidValidity: checkpoint.uidValidity,
              newUidValidity: mailboxState.uidValidity,
            })
            checkpoint = null
          }

          // Skip if checkpoint already has an active window being imported
          if (
            checkpoint &&
            checkpoint.phase === 'importing' &&
            checkpoint.activeWindowStart !== undefined
          ) {
            logger.info('Folder has active import window, skipping listing', {
              folderPath,
              integrationId,
              activeWindowStart: checkpoint.activeWindowStart,
              activeWindowEnd: checkpoint.activeWindowEnd,
            })
            continue
          }

          // Skip if checkpoint is done
          if (checkpoint?.phase === 'done') {
            continue
          }

          // Initialize checkpoint if needed
          if (!checkpoint) {
            checkpoint = {
              runId: generateId(),
              phase: 'listing',
              uidValidity: mailboxState.uidValidity,
              snapshotHighestUid: mailboxState.highestUid,
              nextUidStart: 1,
              discoveredMessageCount: 0,
              importedMessageCount: 0,
              failedMessageCount: 0,
              candidateCursor: `${mailboxState.uidValidity}:${mailboxState.highestUid}`,
            }
          }

          // Nothing to scan if folder is empty
          if (checkpoint.snapshotHighestUid === 0) {
            checkpoint.phase = 'done'
            results.push({
              labelId: label.id,
              folderPath,
              batches: [],
              checkpoint,
              folderScanComplete: true,
            })
            continue
          }

          // Safety valve: if this folder has exhausted its empty-window budget across
          // all jobs in this run, mark it done instead of scanning further.
          if ((checkpoint.totalEmptyWindowsScanned ?? 0) >= MAX_TOTAL_EMPTY_WINDOWS) {
            logger.warn('Folder exceeded max total empty windows, marking done', {
              folderPath,
              integrationId,
              totalEmptyWindowsScanned: checkpoint.totalEmptyWindowsScanned,
              snapshotHighestUid: checkpoint.snapshotHighestUid,
              nextUidStart: checkpoint.nextUidStart,
            })

            checkpoint.phase = 'done'
            results.push({
              labelId: label.id,
              folderPath,
              batches: [],
              checkpoint,
              folderScanComplete: true,
            })
            continue
          }

          // Scan multiple UID windows until we find messages or exhaust budget
          let windowStart = checkpoint.nextUidStart
          let totalWindowsScanned = 0
          let foundUids: number[] = []
          let finalWindowEnd = windowStart

          while (windowStart <= checkpoint.snapshotHighestUid) {
            const windowEnd = Math.min(
              windowStart + UID_SCAN_WINDOW - 1,
              checkpoint.snapshotHighestUid
            )

            const scanResult = await this.syncService.scanUidWindow(
              client,
              mailbox,
              windowStart,
              windowEnd
            )

            totalWindowsScanned++
            finalWindowEnd = windowEnd

            if (scanResult.uids.length > 0) {
              foundUids = scanResult.uids
              break
            }

            // Empty window — advance
            windowStart = windowEnd + 1

            // Budget exhausted — yield to job queue
            if (totalWindowsScanned >= MAX_CONSECUTIVE_EMPTY_WINDOWS) {
              break
            }
          }

          const externalIds = foundUids.map((uid) => `${folderPath}:${uid}`)

          // Split into bounded import batches
          const batches: string[][] = []
          for (let i = 0; i < externalIds.length; i += IMAP_IMPORT_BATCH_SIZE) {
            batches.push(externalIds.slice(i, i + IMAP_IMPORT_BATCH_SIZE))
          }

          const folderScanComplete = finalWindowEnd >= checkpoint.snapshotHighestUid

          // Update checkpoint
          checkpoint.phase = batches.length > 0 ? 'importing' : 'listing'
          checkpoint.discoveredMessageCount += foundUids.length
          checkpoint.totalEmptyWindowsScanned =
            (checkpoint.totalEmptyWindowsScanned ?? 0) +
            (totalWindowsScanned - (foundUids.length > 0 ? 1 : 0))

          if (batches.length > 0) {
            checkpoint.activeWindowStart = windowStart
            checkpoint.activeWindowEnd = finalWindowEnd
            checkpoint.activeWindowBatchCount = batches.length
            checkpoint.activeWindowCompletedBatches = 0
            checkpoint.activeWindowFailedBatches = 0
          } else {
            // All windows were empty — advance nextUidStart past everything scanned
            checkpoint.nextUidStart = finalWindowEnd + 1
          }

          // If scan is complete and no batches to import, mark done
          if (folderScanComplete && batches.length === 0) {
            checkpoint.phase = 'done'
          }

          logger.info('Scanned UID window(s) for folder', {
            folderPath,
            integrationId,
            scanStart: checkpoint.nextUidStart - totalWindowsScanned * UID_SCAN_WINDOW,
            scanEnd: finalWindowEnd,
            windowsScanned: totalWindowsScanned,
            totalEmptyWindowsScanned: checkpoint.totalEmptyWindowsScanned,
            uidsFound: foundUids.length,
            batchCount: batches.length,
            folderScanComplete,
          })

          results.push({
            labelId: label.id,
            folderPath,
            batches,
            checkpoint,
            folderScanComplete,
          })
        } catch (error) {
          logger.error(`Error in windowed full sync for folder ${folderPath}`, {
            error: error instanceof Error ? error.message : String(error),
            integrationId,
          })
        } finally {
          if (lock) lock.release()
        }
      }
    } finally {
      await this.clientProvider.closeClient(client)
    }

    return results
  }

  private async getEnabledLabels(integrationId: string, organizationId: string) {
    return db
      .select()
      .from(schema.Label)
      .where(
        and(
          eq(schema.Label.integrationId, integrationId),
          eq(schema.Label.organizationId, organizationId),
          eq(schema.Label.enabled, true),
          isNull(schema.Label.pendingAction)
        )
      )
  }
}
