// packages/lib/src/providers/google/messages/sync-messages.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type { gmail_v1 } from 'googleapis'
import type { MessageStorageService } from '../../../email/email-storage'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { isDefined } from '../../provider-utils'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'
import { getMessagesBatch } from './batch-fetch'
import { GmailInboundContentIngestor } from './gmail-inbound-content-ingestor'
import { convertMessagesToMessageData } from './parse-message'

const logger = createScopedLogger('google-sync-messages')

/**
 * Personal-channel meta for an inbox (org `inboxes` cache — no DB hit).
 * Personal Gmail channels treat archive as a thread-level Done, reopen on
 * INBOX re-add, and mirror the owner's read state; shared inboxes keep the
 * legacy archive-deletes behavior.
 */
async function getPersonalChannelMeta(
  organizationId: string,
  inboxId: string
): Promise<{ isPersonal: boolean; ownerUserId: string | null }> {
  try {
    const { getOrgCache } = await import('../../../cache')
    const inboxes = await getOrgCache().get(organizationId, 'inboxes')
    const inbox = inboxes.find((i) => i.id === inboxId)
    return { isPersonal: inbox?.isPersonal ?? false, ownerUserId: inbox?.ownerUserId ?? null }
  } catch (error) {
    logger.warn('Failed to resolve personal-channel flag; treating as shared', {
      organizationId,
      inboxId,
      error: (error as Error).message,
    })
    return { isPersonal: false, ownerUserId: null }
  }
}

/**
 * Input parameters for Gmail message synchronization
 */
export interface SyncGmailMessagesInput {
  gmail: gmail_v1.Gmail
  integrationId: string
  inboxId: string
  organizationId: string
  lastHistoryId?: string | null
  since?: Date
  throttler: UniversalThrottler
  storageService: MessageStorageService
  userEmails: string[]
  accessToken: string
}

/**
 * Output from Gmail message synchronization
 */
export interface SyncGmailMessagesOutput {
  messagesProcessed: number
  messagesDeleted: number
  newHistoryId: string
}

/**
 * Synchronizes messages from Gmail using history API or full list
 * @param input - Sync parameters
 * @returns Sync results with message count and new history ID
 */
export async function syncGmailMessages(
  input: SyncGmailMessagesInput
): Promise<SyncGmailMessagesOutput> {
  const {
    gmail,
    integrationId,
    inboxId,
    organizationId,
    lastHistoryId,
    since,
    throttler,
    storageService,
    userEmails,
    accessToken,
  } = input

  logger.info('Starting Gmail sync', {
    integrationId,
    since: since?.toISOString(),
    startHistoryId: lastHistoryId,
  })

  try {
    let totalProcessed = 0
    let totalDeleted = 0
    let highestHistoryId = lastHistoryId ? BigInt(lastHistoryId) : BigInt(0)

    if (lastHistoryId && !since) {
      // Use History API — fall back to full list sync if history ID is expired (404)
      try {
        // Incremental (has a history cursor, no explicit `since`) — the
        // `message:received` workflow-trigger gate reads `ctx.isInitialSync`
        // to distinguish live/incremental inbound from a first-connect
        // backfill; a backfill must not fire thousands of workflow runs.
        storageService.setInitialSyncMode(false)
        const result = await syncViaHistory(
          gmail,
          integrationId,
          inboxId,
          organizationId,
          lastHistoryId,
          throttler,
          storageService,
          userEmails,
          accessToken
        )
        totalProcessed = result.messagesProcessed
        totalDeleted = result.messagesDeleted
        highestHistoryId = BigInt(result.newHistoryId)
      } catch (historyError: any) {
        const status = historyError?.response?.status ?? historyError?.status
        if (status === 404) {
          logger.warn('History ID expired (404) — falling back to full message list sync', {
            integrationId,
            expiredHistoryId: lastHistoryId,
          })
          // Expired cursor forces a full re-list — treat as a backfill for
          // the `message:received` gate (see comment above).
          storageService.setInitialSyncMode(true)
          const result = await syncViaMessageList(
            gmail,
            integrationId,
            inboxId,
            organizationId,
            undefined,
            throttler,
            storageService,
            userEmails,
            accessToken
          )
          totalProcessed = result.messagesProcessed
          highestHistoryId = BigInt(result.newHistoryId)
        } else {
          throw historyError
        }
      }
    } else {
      // No history cursor (first-ever sync) or an explicit `since` re-list —
      // both are the message-list backfill path; see comment above.
      storageService.setInitialSyncMode(true)
      // Use Message List API
      const result = await syncViaMessageList(
        gmail,
        integrationId,
        inboxId,
        organizationId,
        since,
        throttler,
        storageService,
        userEmails,
        accessToken
      )
      totalProcessed = result.messagesProcessed
      highestHistoryId = BigInt(result.newHistoryId)
    }

    // Update integration record
    if (highestHistoryId > BigInt(0) && highestHistoryId.toString() !== lastHistoryId) {
      await db
        .update(schema.Integration)
        .set({
          lastHistoryId: highestHistoryId.toString(),
          lastSyncedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('Updated lastHistoryId', {
        integrationId,
        newHistoryId: highestHistoryId.toString(),
      })
    } else {
      // Update last sync time even if no new messages/history ID change
      await db
        .update(schema.Integration)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('No new messages found or history ID unchanged, updated lastSyncedAt', {
        integrationId,
      })
    }

    logger.info('Gmail sync completed', {
      integrationId,
      messagesProcessed: totalProcessed,
      messagesDeleted: totalDeleted,
      newHistoryId: highestHistoryId.toString(),
    })

    return {
      messagesProcessed: totalProcessed,
      messagesDeleted: totalDeleted,
      newHistoryId: highestHistoryId.toString(),
    }
  } catch (error) {
    // Update sync time even on failure
    await db
      .update(schema.Integration)
      .set({ lastSyncedAt: new Date() })
      .where(eq(schema.Integration.id, integrationId))
      .catch((updateErr) =>
        logger.error('Failed to update lastSyncedAt after error', { updateErr })
      )

    throw await handleGmailError(error, 'syncMessages', integrationId)
  } finally {
    // Never let the flag leak into later calls on this provider instance
    // (e.g. a subsequent `importMessages` call reusing the same `storageService`).
    storageService.setInitialSyncMode(false)
  }
}

/**
 * Sync using Gmail History API (incremental sync)
 * @param gmail - Gmail API client
 * @param integrationId - Integration identifier
 * @param inboxId - Inbox identifier
 * @param organizationId - Organization identifier
 * @param startHistoryId - Starting history ID for incremental sync
 * @param throttler - Rate limiter instance
 * @param storageService - Message storage service
 * @param userEmails - List of user email addresses
 * @param accessToken - OAuth access token
 * @returns Sync results
 */
async function syncViaHistory(
  gmail: gmail_v1.Gmail,
  integrationId: string,
  inboxId: string,
  organizationId: string,
  startHistoryId: string,
  throttler: UniversalThrottler,
  storageService: MessageStorageService,
  userEmails: string[],
  accessToken: string
): Promise<{ messagesProcessed: number; messagesDeleted: number; newHistoryId: string }> {
  let nextPageToken: string | undefined | null
  let highestHistoryId = BigInt(startHistoryId)
  let safeHistoryId = BigInt(startHistoryId) // Only advances when no retriable failures
  let totalProcessed = 0
  let totalDeleted = 0
  let hasRetriableFailures = false

  const { isPersonal, ownerUserId } = await getPersonalChannelMeta(organizationId, inboxId)

  logger.info('Starting history-based sync', {
    integrationId,
    startHistoryId,
    isPersonal,
  })

  do {
    logger.debug('Syncing history', {
      integrationId,
      currentHistoryId: highestHistoryId.toString(),
      nextPageToken,
    })

    const historyResponse = await executeWithThrottle(
      'gmail.history.list',
      async () =>
        gmail.users.history.list({
          userId: 'me',
          startHistoryId: highestHistoryId.toString(),
          pageToken: nextPageToken ?? undefined,
          historyTypes: ['messageAdded', 'messageDeleted', 'labelRemoved', 'labelAdded'],
        }),
      {
        userId: integrationId,
        throttler,
        cost: getGmailQuotaCost('history.list'),
        queue: true,
        priority: 5,
      }
    )

    const historyRecords = historyResponse.data.history || []
    const addedIds = new Set<string>()
    const deletedIds = new Set<string>()
    const inboxRemovedIds = new Set<string>()
    const inboxAddedIds = new Set<string>()
    const trashAddedIds = new Set<string>()
    const spamAddedIds = new Set<string>()
    const unreadAddedIds = new Set<string>()
    const unreadRemovedIds = new Set<string>()

    for (const record of historyRecords) {
      if (record.messagesAdded) {
        for (const msgAdded of record.messagesAdded) {
          if (msgAdded.message?.id) {
            addedIds.add(msgAdded.message.id)
          }
        }
      }
      if (record.messagesDeleted) {
        for (const msgDeleted of record.messagesDeleted) {
          if (msgDeleted.message?.id) {
            deletedIds.add(msgDeleted.message.id)
          }
        }
      }
      // Label removals: INBOX = archive in Gmail; UNREAD = marked read.
      if (record.labelsRemoved) {
        for (const labelChange of record.labelsRemoved) {
          const messageId = labelChange.message?.id
          if (!messageId) continue
          if (labelChange.labelIds?.includes('INBOX')) inboxRemovedIds.add(messageId)
          if (labelChange.labelIds?.includes('UNREAD')) unreadRemovedIds.add(messageId)
        }
      }
      // Label adds: INBOX = unarchive / moved (back) into the inbox;
      // TRASH / SPAM = trashed or marked spam; UNREAD = marked unread
      // (personal channels).
      if (record.labelsAdded) {
        for (const labelChange of record.labelsAdded) {
          const messageId = labelChange.message?.id
          if (!messageId) continue
          if (labelChange.labelIds?.includes('INBOX')) inboxAddedIds.add(messageId)
          if (labelChange.labelIds?.includes('TRASH')) trashAddedIds.add(messageId)
          if (labelChange.labelIds?.includes('SPAM')) spamAddedIds.add(messageId)
          if (labelChange.labelIds?.includes('UNREAD')) unreadAddedIds.add(messageId)
        }
      }

      // Track highest history ID within this page
      const recordHistoryId = BigInt(record.id ?? '0')
      if (recordHistoryId > highestHistoryId) {
        highestHistoryId = recordHistoryId
      }
    }

    // Update highest history ID if no records but response has historyId
    if (historyRecords.length === 0 && historyResponse.data.historyId) {
      const currentHistoryId = BigInt(historyResponse.data.historyId)
      if (currentHistoryId > highestHistoryId) {
        highestHistoryId = currentHistoryId
      }
    }

    // Shared channels keep the legacy behavior: archiving in Gmail deletes
    // locally. Personal channels treat archive as a thread-level Done (handled
    // separately below), so their INBOX-label removals are NOT deletions.
    if (!isPersonal) {
      for (const id of inboxRemovedIds) deletedIds.add(id)
    }

    // Deduplicate: messages in both added and deleted → net result is deleted
    const finalAddedIds = [...addedIds].filter((id) => !deletedIds.has(id))

    // Process deletions
    if (deletedIds.size > 0) {
      const deleted = await storageService.deleteMessagesByExternalIds(integrationId, [
        ...deletedIds,
      ])
      totalDeleted += deleted

      logger.info('Processed message deletions from history', {
        integrationId,
        deletedCount: deleted,
        rawDeletedIds: deletedIds.size,
      })
    }

    // Personal-channel label-derived status changes — thread-level, messages
    // kept intact. Precedence when one page carries multiple label events for
    // the same message: deleted > trash > spam > reopen (INBOX add) > archive
    // (INBOX remove). Gmail-side trash/spam also remove INBOX, so those ids
    // must not fall through to the archive bucket.
    if (isPersonal) {
      const trashIds = [...trashAddedIds].filter((id) => !deletedIds.has(id))
      const spamIds = [...spamAddedIds].filter(
        (id) => !deletedIds.has(id) && !trashAddedIds.has(id)
      )
      const reopenIds = [...inboxAddedIds].filter(
        (id) => !deletedIds.has(id) && !trashAddedIds.has(id) && !spamAddedIds.has(id)
      )
      const archiveIds = [...inboxRemovedIds].filter(
        (id) =>
          !deletedIds.has(id) &&
          !trashAddedIds.has(id) &&
          !spamAddedIds.has(id) &&
          !inboxAddedIds.has(id)
      )
      if (trashIds.length > 0) {
        await storageService.trashThreadsByMessageExternalIds(integrationId, trashIds)
      }
      if (spamIds.length > 0) {
        await storageService.markThreadsSpamByMessageExternalIds(integrationId, spamIds)
      }
      if (reopenIds.length > 0) {
        await storageService.reopenThreadsByMessageExternalIds(integrationId, reopenIds)
      }
      if (archiveIds.length > 0) {
        await storageService.archiveThreadsByMessageExternalIds(integrationId, archiveIds)
      }

      // Read-state from UNREAD label events — mailbox owner only. Messages
      // added this page are excluded: their unread state is set at ingest.
      // Unread wins over read when both appear for one message in a page
      // (safer to re-surface a thread than to silently mark it read).
      if (ownerUserId) {
        const markUnreadIds = [...unreadAddedIds].filter(
          (id) => !deletedIds.has(id) && !addedIds.has(id)
        )
        const markReadIds = [...unreadRemovedIds].filter(
          (id) => !deletedIds.has(id) && !addedIds.has(id) && !unreadAddedIds.has(id)
        )
        if (markUnreadIds.length > 0) {
          await storageService.setThreadReadStateByMessageExternalIds(
            integrationId,
            markUnreadIds,
            false,
            ownerUserId
          )
        }
        if (markReadIds.length > 0) {
          await storageService.setThreadReadStateByMessageExternalIds(
            integrationId,
            markReadIds,
            true,
            ownerUserId
          )
        }
      }
    }

    // Fetch and store added messages
    if (finalAddedIds.length > 0) {
      logger.info(`Found ${finalAddedIds.length} new message IDs via history. Fetching details.`, {
        integrationId,
      })

      const {
        parsed,
        raw,
        failedMessageIds: failedFetchIds,
      } = await getMessagesBatch({
        messageIds: finalAddedIds,
        integrationId,
        throttler,
        accessToken,
      })

      if (failedFetchIds.length > 0) {
        logger.warn('Some message IDs failed to fetch', {
          failedFetchCount: failedFetchIds.length,
          failedFetchIds: failedFetchIds.slice(0, 20),
          integrationId,
        })
      }

      if (parsed.length > 0) {
        const messageDataArray = convertMessagesToMessageData(
          parsed,
          raw,
          integrationId,
          inboxId,
          organizationId,
          userEmails
        )

        const ingestor = new GmailInboundContentIngestor(organizationId, storageService)
        const result = await ingestor.storeBatchWithIngest(messageDataArray, {
          accessToken,
          integrationId,
          throttler,
        })
        totalProcessed += result.storedCount

        // If there are retriable failures, do not advance historyId past this page
        if (result.retriableFailures.length > 0 || failedFetchIds.length > 0) {
          hasRetriableFailures = true
          logger.warn('Retriable failures detected — historyId will not advance past this page', {
            retriableIngestFailures: result.retriableFailures.length,
            failedFetchIds: failedFetchIds.length,
            integrationId,
          })
        }

        logger.info('Processed history batch', {
          fetched: parsed.length,
          stored: result.storedCount,
          failedIngest: result.failedCount,
          failedFetch: failedFetchIds.length,
          integrationId,
        })
      }
    }

    // Only advance safeHistoryId if this page had no retriable failures
    if (!hasRetriableFailures) {
      safeHistoryId = highestHistoryId
    }

    nextPageToken = historyResponse.data.nextPageToken
  } while (nextPageToken)

  // Use safeHistoryId so we re-process pages that had retriable failures next cycle
  const effectiveHistoryId = hasRetriableFailures ? safeHistoryId : highestHistoryId

  logger.info('Gmail history sync cycle completed', {
    integrationId,
    highestHistoryId: highestHistoryId.toString(),
    effectiveHistoryId: effectiveHistoryId.toString(),
    hasRetriableFailures,
    messagesProcessed: totalProcessed,
    messagesDeleted: totalDeleted,
  })

  return {
    messagesProcessed: totalProcessed,
    messagesDeleted: totalDeleted,
    newHistoryId: effectiveHistoryId.toString(),
  }
}

/**
 * Sync using Gmail Messages List API (full sync or fallback)
 * @param gmail - Gmail API client
 * @param integrationId - Integration identifier
 * @param inboxId - Inbox identifier
 * @param organizationId - Organization identifier
 * @param since - Optional date to sync messages after
 * @param throttler - Rate limiter instance
 * @param storageService - Message storage service
 * @param userEmails - List of user email addresses
 * @param accessToken - OAuth access token
 * @returns Sync results
 */
async function syncViaMessageList(
  gmail: gmail_v1.Gmail,
  integrationId: string,
  inboxId: string,
  organizationId: string,
  since: Date | undefined,
  throttler: UniversalThrottler,
  storageService: MessageStorageService,
  userEmails: string[],
  accessToken: string
): Promise<{ messagesProcessed: number; newHistoryId: string }> {
  const query = since ? `after:${Math.floor(since.getTime() / 1000)}` : ''
  let nextPageToken: string | undefined | null
  let highestHistoryId = BigInt(0)
  let safeHistoryId = BigInt(0)
  let totalProcessed = 0
  let hasRetriableFailures = false

  logger.warn(`No startHistoryId found. Syncing via message list with query: "${query}"`, {
    integrationId,
  })

  do {
    logger.debug('Listing messages', {
      integrationId,
      query,
      nextPageToken,
    })

    const listResponse = await executeWithThrottle(
      'gmail.messages.list',
      async () =>
        gmail.users.messages.list({
          userId: 'me',
          q: query,
          pageToken: nextPageToken ?? undefined,
          includeSpamTrash: false,
          maxResults: 100,
        }),
      {
        userId: integrationId,
        throttler,
        cost: getGmailQuotaCost('messages.list'),
        queue: true,
        priority: 5,
      }
    )

    const messages = listResponse.data.messages || []
    if (messages.length === 0) break // Exit if no messages found

    const messageIds = messages.map((msg) => msg.id).filter(isDefined)

    logger.info(`Found ${messageIds.length} message IDs via list query. Fetching details.`, {
      integrationId,
    })

    const {
      parsed: fetchedMessages,
      raw: rawMessages,
      failedMessageIds: failedFetchIds,
    } = await getMessagesBatch({
      messageIds,
      integrationId,
      throttler,
      accessToken,
    })

    if (failedFetchIds.length > 0) {
      logger.warn('Some message IDs failed to fetch during list sync', {
        failedFetchCount: failedFetchIds.length,
        failedFetchIds: failedFetchIds.slice(0, 20),
        integrationId,
      })
    }

    if (fetchedMessages.length > 0) {
      const messageDataArray = convertMessagesToMessageData(
        fetchedMessages,
        rawMessages,
        integrationId,
        inboxId,
        organizationId,
        userEmails
      )

      const ingestor = new GmailInboundContentIngestor(organizationId, storageService)
      const result = await ingestor.storeBatchWithIngest(messageDataArray, {
        accessToken,
        integrationId,
        throttler,
      })
      totalProcessed += result.storedCount

      // Track highest history ID
      for (const msg of fetchedMessages) {
        const msgHistoryId = BigInt(msg.historyId)
        if (msgHistoryId > highestHistoryId) {
          highestHistoryId = msgHistoryId
        }
      }

      if (result.retriableFailures.length > 0 || failedFetchIds.length > 0) {
        hasRetriableFailures = true
        logger.warn('Retriable failures in list batch — historyId may not advance fully', {
          retriableIngestFailures: result.retriableFailures.length,
          failedFetchIds: failedFetchIds.length,
          integrationId,
        })
      } else {
        safeHistoryId = highestHistoryId
      }

      logger.info('Processed list batch', {
        fetched: fetchedMessages.length,
        stored: result.storedCount,
        failedIngest: result.failedCount,
        failedFetch: failedFetchIds.length,
        highestHistoryId: highestHistoryId.toString(),
        integrationId,
      })
    }

    nextPageToken = listResponse.data.nextPageToken
  } while (nextPageToken)

  const effectiveHistoryId = hasRetriableFailures ? safeHistoryId : highestHistoryId

  logger.info('Gmail list-based sync completed', {
    integrationId,
    messagesProcessed: totalProcessed,
    highestHistoryId: highestHistoryId.toString(),
    effectiveHistoryId: effectiveHistoryId.toString(),
    hasRetriableFailures,
  })

  return {
    messagesProcessed: totalProcessed,
    newHistoryId: effectiveHistoryId.toString(),
  }
}
