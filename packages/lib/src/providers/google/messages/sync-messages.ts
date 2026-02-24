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
import { convertMessagesToMessageData } from './parse-message'

const logger = createScopedLogger('google-sync-messages')

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
      // Use History API
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
    } else {
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
  let totalProcessed = 0
  let totalDeleted = 0

  logger.info('Starting history-based sync', {
    integrationId,
    startHistoryId,
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
          historyTypes: ['messageAdded', 'messageDeleted', 'labelRemoved'],
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
      // Treat INBOX label removal as deletion (archived messages)
      if (record.labelsRemoved) {
        for (const labelChange of record.labelsRemoved) {
          if (labelChange.labelIds?.includes('INBOX') && labelChange.message?.id) {
            deletedIds.add(labelChange.message.id)
          }
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

    // Fetch and store added messages
    if (finalAddedIds.length > 0) {
      logger.info(`Found ${finalAddedIds.length} new message IDs via history. Fetching details.`, {
        integrationId,
      })

      const messages = await getMessagesBatch({
        messageIds: finalAddedIds,
        integrationId,
        throttler,
        accessToken,
      })

      if (messages.length > 0) {
        const messageDataArray = convertMessagesToMessageData(
          messages,
          integrationId,
          inboxId,
          organizationId,
          userEmails
        )

        const storedCount = await storageService.batchStoreMessages(messageDataArray)
        totalProcessed += storedCount

        logger.info('Processed history batch', {
          fetched: messages.length,
          stored: storedCount,
          integrationId,
        })
      }
    }

    nextPageToken = historyResponse.data.nextPageToken
  } while (nextPageToken)

  logger.info('Gmail history sync cycle completed', {
    integrationId,
    highestHistoryId: highestHistoryId.toString(),
    messagesProcessed: totalProcessed,
    messagesDeleted: totalDeleted,
  })

  return {
    messagesProcessed: totalProcessed,
    messagesDeleted: totalDeleted,
    newHistoryId: highestHistoryId.toString(),
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
  const query = since ? `after:${Math.floor(since.getTime() / 1000)}` : 'in:inbox'
  let nextPageToken: string | undefined | null
  let highestHistoryId = BigInt(0)
  let totalProcessed = 0

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

    const fetchedMessages = await getMessagesBatch({
      messageIds,
      integrationId,
      throttler,
      accessToken,
    })

    if (fetchedMessages.length > 0) {
      const messageDataArray = convertMessagesToMessageData(
        fetchedMessages,
        integrationId,
        inboxId,
        organizationId,
        userEmails
      )

      const storedCount = await storageService.batchStoreMessages(messageDataArray)
      totalProcessed += storedCount

      // Track highest history ID
      for (const msg of fetchedMessages) {
        const msgHistoryId = BigInt(msg.historyId)
        if (msgHistoryId > highestHistoryId) {
          highestHistoryId = msgHistoryId
        }
      }

      logger.info('Processed list batch', {
        fetched: fetchedMessages.length,
        stored: storedCount,
        highestHistoryId: highestHistoryId.toString(),
        integrationId,
      })
    }

    nextPageToken = listResponse.data.nextPageToken
  } while (nextPageToken)

  logger.info('Gmail list-based sync completed', {
    integrationId,
    messagesProcessed: totalProcessed,
    highestHistoryId: highestHistoryId.toString(),
  })

  return {
    messagesProcessed: totalProcessed,
    newHistoryId: highestHistoryId.toString(),
  }
}
