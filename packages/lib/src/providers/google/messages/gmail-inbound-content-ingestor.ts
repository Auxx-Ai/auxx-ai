// packages/lib/src/providers/google/messages/gmail-inbound-content-ingestor.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData, MessageStorageService } from '../../../email/email-storage'
import { InboundAttachmentIngestService } from '../../../email/inbound/attachment-ingest.service'
import { InboundBodyIngestService } from '../../../email/inbound/body-ingest.service'
import type { AttachmentIngestInput } from '../../../email/inbound/ingest-types'
import type { GmailFetchContext } from '../types'
import { fetchAllGmailAttachmentBytes } from './gmail-attachment-fetcher'

const logger = createScopedLogger('gmail-inbound-content-ingestor')

/**
 * Per-message failure detail returned by storeBatchWithIngest.
 */
export interface IngestFailure {
  externalId: string
  error: string
  retriable: boolean
}

/**
 * Structured result from storeBatchWithIngest.
 */
export interface BatchIngestResult {
  storedCount: number
  failedCount: number
  failedExternalIds: string[]
  retriableFailures: IngestFailure[]
  nonRetriableFailures: IngestFailure[]
}

/**
 * Orchestrates body ingest + message storage + attachment ingest for Gmail.
 * Replaces direct batchStoreMessages calls to add inbound content processing.
 */
export class GmailInboundContentIngestor {
  private bodyIngestService = new InboundBodyIngestService()
  private attachmentIngestService = new InboundAttachmentIngestService()

  constructor(
    private organizationId: string,
    private storageService: MessageStorageService
  ) {}

  /**
   * Store a batch of Gmail messages with inbound content ingest.
   * Preserves chronological sort and initial-sync bookkeeping from batchStoreMessages.
   *
   * Returns a structured result so the caller can decide whether to advance
   * the sync cursor or schedule retries.
   */
  async storeBatchWithIngest(
    messages: MessageData[],
    fetchContext: GmailFetchContext,
    options?: { batchId?: string; isInitialSync?: boolean }
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
      `Starting batch store with ingest for ${messages.length} messages (sorted chronologically)`,
      {
        organizationId: this.organizationId,
        isInitialSync: options?.isInitialSync,
      }
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

        logger.error('Error storing message with ingest in batch', {
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
      `Batch store with ingest completed: ${storedCount} stored, ${failedCount} failed (${retriableFailures.length} retriable).`,
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
   * Store a single Gmail message with inbound content ingest.
   * For outbound/draft messages, delegates directly to storeMessage().
   *
   * Body ingest failures are degraded (logged) but do not prevent message storage.
   */
  private async storeOneWithIngest(
    messageData: MessageData,
    fetchContext: GmailFetchContext
  ): Promise<string> {
    // Skip ingest for outbound/draft messages — they go straight through
    if (!messageData.isInbound) {
      return this.storageService.storeMessage(messageData)
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
      // textHtml nulling happens inside storeMessage (Fix 2)
    }

    // 2. Store message
    const messageId = await this.storageService.storeMessage(messageData)

    // 3. Attachment ingest (after storeMessage, only for inbound with attachments)
    const providerAttachments = messageData.providerAttachments ?? []

    logger.info('Attachment ingest check', {
      messageId,
      externalId: messageData.externalId,
      providerAttachmentCount: providerAttachments.length,
      attachments: providerAttachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        inline: a.inline,
        contentId: a.contentId,
        hasEmbeddedData: !!a.embeddedData,
        hasProviderAttachmentId: !!a.providerAttachmentId,
      })),
    })

    if (providerAttachments.length === 0) return messageId

    // Fetch bytes (embedded + API)
    const { resolved, failedCount } = await fetchAllGmailAttachmentBytes(
      messageData.externalId,
      providerAttachments,
      fetchContext
    )

    logger.info('Attachment bytes fetch result', {
      messageId,
      resolvedCount: resolved.size,
      failedCount,
      resolvedIndices: [...resolved.keys()],
    })

    // Build inputs — only include successfully resolved attachments (Fix 3)
    const inputs: AttachmentIngestInput[] = []
    for (let i = 0; i < providerAttachments.length; i++) {
      const bytes = resolved.get(i)
      if (!bytes || bytes.length === 0) {
        logger.warn('Skipping attachment with missing bytes', {
          gmailMessageId: messageData.externalId,
          filename: providerAttachments[i]!.filename,
          providerAttachmentId: providerAttachments[i]!.providerAttachmentId,
        })
        continue
      }
      const att = providerAttachments[i]!
      inputs.push({
        content: bytes,
        filename: att.filename,
        mimeType: att.mimeType,
        inline: att.inline,
        contentId: att.contentId,
        attachmentOrder: i,
      })
    }

    if (inputs.length > 0) {
      logger.info('Starting attachment ingest', {
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
        // Fix 4: skip reconciliation if any fetch failed (partial set)
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
        logger.info('Attachment ingest completed successfully', { messageId })
      } catch (error) {
        logger.error('Attachment ingest FAILED', {
          messageId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
        // Re-throw so the caller can track the failure
        throw error
      }
    }

    return messageId
  }
}

/**
 * Classify whether an ingest error is likely retriable.
 * DB connection errors, timeouts, and rate limits are retriable.
 * Validation errors and constraint violations are not.
 */
function isRetriableIngestError(error: unknown): boolean {
  if (!(error instanceof Error)) return true
  const msg = error.message.toLowerCase()
  if (msg.includes('connection') || msg.includes('timeout') || msg.includes('econnrefused')) {
    return true
  }
  if (msg.includes('rate limit') || msg.includes('too many')) return true
  if (msg.includes('constraint') || msg.includes('unique') || msg.includes('validation')) {
    return false
  }
  // Default to retriable for unknown errors
  return true
}
