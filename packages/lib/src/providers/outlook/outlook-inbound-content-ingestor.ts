// packages/lib/src/providers/outlook/outlook-inbound-content-ingestor.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData, MessageStorageService } from '../../email/email-storage'
import { InboundAttachmentIngestService } from '../../email/inbound/attachment-ingest.service'
import { InboundBodyIngestService } from '../../email/inbound/body-ingest.service'
import type {
  AttachmentIngestInput,
  BatchIngestResult,
  IngestFailure,
} from '../../email/inbound/ingest-types'
import { isRetriableIngestError } from '../../email/inbound/ingest-types'
import {
  fetchOutlookAttachments,
  type OutlookFetchContext,
  type OutlookFetchedAttachment,
} from './outlook-attachment-fetcher'

export type { OutlookFetchContext } from './outlook-attachment-fetcher'

const logger = createScopedLogger('outlook-inbound-content-ingestor')

/**
 * Orchestrates body ingest + message storage + attachment ingest for Outlook.
 * Replaces direct batchStoreMessages calls to add inbound content processing.
 */
export class OutlookInboundContentIngestor {
  private bodyIngestService = new InboundBodyIngestService()
  private attachmentIngestService = new InboundAttachmentIngestService()

  constructor(
    private organizationId: string,
    private storageService: MessageStorageService
  ) {}

  /**
   * Store a batch of Outlook messages with inbound content ingest.
   * Preserves chronological sort and tracks failures per-message.
   */
  async storeBatchWithIngest(
    messages: MessageData[],
    fetchContext: OutlookFetchContext
  ): Promise<BatchIngestResult> {
    if (messages.length === 0) {
      return {
        storedCount: 0,
        failedCount: 0,
        failedExternalIds: [],
        retriableFailures: [],
        nonRetriableFailures: [],
      }
    }

    // Sort messages chronologically (same as batchStoreMessages)
    const sortedMessages = [...messages].sort(
      (a, b) => (a.sentAt?.getTime() || 0) - (b.sentAt?.getTime() || 0)
    )

    logger.info(
      `Starting batch store with ingest for ${messages.length} Outlook messages (sorted chronologically)`,
      { organizationId: this.organizationId }
    )

    let storedCount = 0
    const retriableFailures: IngestFailure[] = []
    const nonRetriableFailures: IngestFailure[] = []

    for (const messageData of sortedMessages) {
      try {
        await this.storeOneWithIngest(messageData, fetchContext)
        storedCount++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const retriable = isRetriableIngestError(error)

        logger.error('Error storing Outlook message with ingest in batch', {
          error: message,
          externalId: messageData.externalId,
          retriable,
        })

        const failure: IngestFailure = {
          externalId: messageData.externalId,
          error: message,
          retriable,
        }
        if (retriable) {
          retriableFailures.push(failure)
        } else {
          nonRetriableFailures.push(failure)
        }
      }
    }

    const failedCount = retriableFailures.length + nonRetriableFailures.length
    const failedExternalIds = [
      ...retriableFailures.map((f) => f.externalId),
      ...nonRetriableFailures.map((f) => f.externalId),
    ]

    logger.info(
      `Outlook batch store with ingest completed: ${storedCount} stored, ${failedCount} failed (${retriableFailures.length} retriable).`,
      {
        organizationId: this.organizationId,
        storedCount,
        failedCount,
        retriableFailures: retriableFailures.length,
        nonRetriableFailures: nonRetriableFailures.length,
        failedExternalIds,
      }
    )

    return {
      storedCount,
      failedCount,
      failedExternalIds,
      retriableFailures,
      nonRetriableFailures,
    }
  }

  /**
   * Store a single Outlook message with inbound content ingest.
   * For outbound/draft messages, delegates directly to storeMessage().
   *
   * Body ingest failures are degraded (logged) but do not prevent message storage.
   */
  private async storeOneWithIngest(
    messageData: MessageData,
    fetchContext: OutlookFetchContext
  ): Promise<string> {
    // Skip ingest for outbound/draft messages — they go straight through
    if (!messageData.isInbound) {
      const { messageId } = await this.storageService.storeMessage(messageData)
      return messageId
    }

    const contentScopeId = messageData.externalId

    // 1. Body ingest (before storeMessage) — fail-open: errors are degraded, not fatal
    if (messageData.textHtml) {
      try {
        const bodyMeta = await this.bodyIngestService.ingestBody(
          { textHtml: messageData.textHtml },
          { organizationId: this.organizationId, contentScopeId }
        )
        messageData.htmlBodyStorageLocationId = bodyMeta.htmlBodyStorageLocationId
      } catch (error) {
        logger.warn('Body ingest failed, storing message with inline HTML (degraded ingest)', {
          externalId: messageData.externalId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Leave htmlBodyStorageLocationId unset — message stores with textHtml inline
      }
    }

    // 2. Store message
    const { messageId, isNew } = await this.storageService.storeMessage(messageData)

    // Skip attachment ingest for already-processed messages
    if (!isNew) {
      logger.debug('Outlook message already exists, skipping attachment ingest', {
        messageId,
        externalId: messageData.externalId,
      })
      return messageId
    }

    // 3. Attachment ingest (after storeMessage, only for new inbound with hasAttachments)
    if (!messageData.hasAttachments) return messageId

    // Fetch all file attachments from Graph API
    const { attachments: fetched, failedCount } = await fetchOutlookAttachments(
      messageData.externalId,
      fetchContext
    )

    logger.info('Outlook attachment fetch result', {
      messageId,
      externalId: messageData.externalId,
      fetchedCount: fetched.length,
      failedCount,
    })

    // If ALL attachment fetches failed, throw a retriable error so the caller
    // can track this as a failure and avoid advancing cursors/ACKing the batch.
    if (fetched.length === 0 && failedCount > 0) {
      throw new Error(
        `All ${failedCount} attachment fetches failed for Outlook message ${messageData.externalId}`
      )
    }

    if (fetched.length === 0) return messageId // genuinely no file attachments

    // Build ingest inputs — use providerIndex for stable attachmentOrder
    const inputs: AttachmentIngestInput[] = fetched.map((att) => ({
      content: att.content,
      filename: att.meta.filename,
      mimeType: att.meta.mimeType,
      inline: att.meta.inline,
      contentId: att.meta.contentId,
      attachmentOrder: att.providerIndex,
    }))

    logger.info('Starting Outlook attachment ingest', {
      messageId,
      inputCount: inputs.length,
      inputs: inputs.map((i) => ({
        filename: i.filename,
        mimeType: i.mimeType,
        inline: i.inline,
        contentId: i.contentId,
        size: i.content.length,
      })),
    })

    try {
      await this.attachmentIngestService.ingestAll(
        inputs,
        {
          organizationId: this.organizationId,
          messageId,
          contentScopeId,
        },
        {
          skipReconciliation: failedCount > 0,
        }
      )
      logger.info('Outlook attachment ingest completed successfully', { messageId })
    } catch (error) {
      logger.error('Outlook attachment ingest FAILED', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      // Re-throw so the caller can track the failure
      throw error
    }

    return messageId
  }
}
