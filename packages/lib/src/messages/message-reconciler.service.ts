// packages/lib/src/messages/message-reconciler.service.ts

import { type Database, schema } from '@auxx/database'
import { SendStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq, inArray } from 'drizzle-orm'
import type { MessageData } from '../email/email-storage'
import type { ThreadManagerService } from './thread-manager.service'
import type { ReconciliationInput } from './types/message-sending.types'

const logger = createScopedLogger('message-reconciler')

/**
 * Handles reconciliation of sent messages with provider responses
 * and prevents duplicate creation during sync
 */
export class MessageReconcilerService {
  constructor(
    private organizationId: string,
    private threadManager: ThreadManagerService,
    private db: Database
  ) {}

  /**
   * Reconciles a sent message with provider response
   */
  async reconcileSentMessage(input: ReconciliationInput): Promise<void> {
    const { messageId, sendToken, providerResponse, threadContext } = input
    const reconcileThread = input.reconcileThread !== false

    logger.info('Reconciling sent message', {
      messageId,
      sendToken,
      success: providerResponse.success,
      providerMessageId: providerResponse.messageId,
      providerThreadId: providerResponse.threadId,
    })

    // Step 1: Update message with provider data
    const updateData: Record<string, any> = {
      sendStatus: providerResponse.success ? SendStatus.SENT : SendStatus.FAILED,
      sentAt: providerResponse.success ? providerResponse.timestamp || new Date() : null,
      // Don't set receivedAt for sent messages - this is only for incoming messages
      lastAttemptAt: new Date(),
    }

    if (providerResponse.success && providerResponse.messageId) {
      updateData.externalId = providerResponse.messageId
    }

    if (providerResponse.success && providerResponse.threadId) {
      updateData.externalThreadId = providerResponse.threadId
    }

    if (providerResponse.success && providerResponse.historyId) {
      updateData.historyId = BigInt(providerResponse.historyId)
    }

    if (!providerResponse.success && providerResponse.error) {
      updateData.providerError = providerResponse.error
    }

    // Add reconciliation metadata
    updateData.metadata = {
      reconciled: true,
      reconciledAt: new Date().toISOString(),
      providerResponse: {
        messageId: providerResponse.messageId,
        threadId: providerResponse.threadId,
        historyId: providerResponse.historyId,
        labelIds: providerResponse.labelIds,
        success: providerResponse.success,
        timestamp: providerResponse.timestamp?.toISOString(),
      },
    }

    // First get current attempts count
    const currentMessage = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, messageId),
      columns: { attempts: true },
    })

    if (currentMessage) {
      updateData.attempts = (currentMessage.attempts || 0) + 1
    }

    await this.db.update(schema.Message).set(updateData).where(eq(schema.Message.id, messageId))

    // Step 2: Reconcile thread if needed (not just pending). Skipped for
    // providers without external thread state (e.g. chat) — they echo our own
    // thread id back, and reconciling would clobber thread metadata.
    if (reconcileThread && providerResponse.threadId) {
      await this.threadManager.reconcileThread(threadContext.id, {
        externalThreadId: providerResponse.threadId,
        actualMessageId: providerResponse.messageId || messageId,
        sentAt: providerResponse.timestamp || new Date(),
      })
    }

    // Step 3: Mark duplicates for cleanup if we detect any
    if (
      reconcileThread &&
      providerResponse.success &&
      providerResponse.threadId &&
      providerResponse.messageId
    ) {
      await this.markDuplicatesForCleanup({
        realThreadId: threadContext.id,
        realMessageId: messageId,
        externalThreadId: providerResponse.threadId,
        externalMessageId: providerResponse.messageId,
      })
    }

    logger.info('Message reconciliation complete', {
      messageId,
      success: providerResponse.success,
    })
  }

  /**
   * Handles incoming sync that might duplicate sent messages
   * Called during message storage to prevent duplicates
   */
  async reconcileIncomingSync(messageData: MessageData): Promise<{
    isReconciled: boolean
    existingMessageId?: string
  }> {
    // Check multiple strategies to find recently sent messages

    // Strategy 0: Check by the echoed `Message.id` (exact, and the cheapest).
    //
    // Gmail, SES (Nodemailer), and Outlook all stamp `X-AuxxAi-Message-Id: <our
    // Message.id>` on outbound now. Outlook needs it to work at all: Graph mints its
    // own `Message-ID` and returns nothing from `/me/sendMail`, so a custom `x-`
    // header is the ONLY correlation key available for its Sent Items copy — see
    // `channel-provider.interface.ts:50-56`. Gmail and SES already set the wire
    // `Message-ID` from our own value, so for THEM the header is a supplement, not
    // the primary key: it's what lets the org-scoped suppress-only check in
    // `store-message.ts` (loop-guard plan §6 supplement) still recognize an echo
    // whose `Message-ID` an intermediate forwarder rewrote.
    // Microsoft Graph strips every transport header from the Sent Items copy but
    // preserves custom `x-` names (verified 2026-08-01: the copy came back carrying
    // only `X-AuxxAi-Message`), so when the provider reads that header back into
    // `echoedMessageId` we have an EXACT primary-key correlation — no subject
    // guessing, no time window, no dependence on the poll interval. That is why it
    // runs before Strategy 1.
    //
    // Two guards, because a header is attacker-controllable input, not our own state:
    //   - `organizationId` scope: an id lifted from another tenant must never
    //     resolve. This is a security boundary, not a nicety.
    //   - `sendToken IS NOT NULL`: only a message WE sent can have a Sent-folder
    //     echo. Without this, a spoofed header could graft an arbitrary inbound
    //     message onto any row in the org.
    // A miss on either guard (or a bogus id) falls through to the strategies below
    // rather than failing the ingest.
    const byEchoedId = messageData.echoedMessageId
      ? await this.db.query.Message.findFirst({
          // Every predicate here is a guard, because the id arrives in a header and
          // headers are attacker-controllable. The org and integration both come
          // from the INGESTING side, never from the header, so a forged id cannot
          // reach another tenant or another channel — an echo always arrives on the
          // same integration that sent it. `sendToken IS NOT NULL` means only a
          // message WE sent can be a reconcile target, so a forged header cannot
          // graft inbound mail onto an arbitrary row.
          where: (messages, { eq, and, isNotNull }) =>
            and(
              eq(messages.id, messageData.echoedMessageId!),
              eq(messages.organizationId, messageData.organizationId),
              eq(messages.integrationId, messageData.integrationId),
              isNotNull(messages.sendToken)
            ),
          columns: {
            id: true,
            sendToken: true,
            threadId: true,
          },
        })
      : null

    if (byEchoedId) {
      logger.info('Found sent message by echoed X-AuxxAi-Message-Id, reconciling', {
        messageId: byEchoedId.id,
        externalId: messageData.externalId,
      })

      await this.mergeIncomingProviderData(byEchoedId.id, messageData)
      return {
        isReconciled: true,
        existingMessageId: byEchoedId.id,
      }
    }

    // Strategy 1: Check by internetMessageId (most reliable)
    const byMessageId = messageData.internetMessageId
      ? await this.db.query.Message.findFirst({
          where: (messages, { eq, and, inArray }) =>
            and(
              eq(messages.organizationId, messageData.organizationId),
              eq(messages.internetMessageId, messageData.internetMessageId!),
              inArray(messages.sendStatus, [SendStatus.PENDING, SendStatus.SENT])
            ),
          columns: {
            id: true,
            sendToken: true,
            threadId: true,
          },
        })
      : null

    if (byMessageId) {
      logger.info('Found pending message by internetMessageId, reconciling', {
        messageId: byMessageId.id,
        internetMessageId: messageData.internetMessageId,
      })

      await this.mergeIncomingProviderData(byMessageId.id, messageData)
      return {
        isReconciled: true,
        existingMessageId: byMessageId.id,
      }
    }

    // Strategy 2: Check by subject and time window.
    //
    // This is the fallback for providers whose Sent-folder echo carries neither our
    // `internetMessageId` nor a usable `externalId` (Outlook: Graph mints its own
    // Message-ID and returns nothing from `/me/sendMail`). It is a heuristic, so it
    // is deliberately narrow:
    //   - OUTBOUND only — see the direction guard below
    //   - same integration — never reconcile an echo onto another channel's message
    //   - `sendToken IS NOT NULL` — only a message WE sent can have a Sent-folder
    //     echo, so this is both a correctness guard and the main selectivity win
    //   - newest candidate first, so two same-subject sends in the window resolve to
    //     the one nearest in time rather than an arbitrary row
    //
    // ⚠️ The direction guard is what makes this strategy safe on subject-less
    // channels. Unlike Strategy 1 and the echoed-id strategy above, this one has NO
    // identity key — it matches purely on (integration, subject, 60s skew). On email
    // the subject carries the selectivity. **SMS has no subject**, so
    // `eq(subject, messageData.subject || '')` degenerates to `'' = ''` and matches
    // every SMS on the channel, leaving a 60-second window as the only discriminator.
    //
    // Measured live on Quo (2026-08-14): an outbound SMS at 20:49:47 and the
    // customer's reply 49s later collapsed into ONE row — the inbound message
    // overwrote the outbound row's `externalId` and timestamps while keeping the
    // outbound body and `isInbound: false`. The reply survived only inside
    // `metadata`. On a support line "customer replies within a minute" is the normal
    // case, not an edge case.
    //
    // A Sent-folder echo is by definition a copy of a message WE sent, so it is
    // always outbound. An inbound message can never be one, on any provider.
    const recentlySent = messageData.isInbound
      ? null
      : await this.db.query.Message.findFirst({
          where: (messages, { eq, and, inArray, gte, isNotNull }) =>
            and(
              eq(messages.organizationId, messageData.organizationId),
              eq(messages.integrationId, messageData.integrationId),
              eq(messages.subject, messageData.subject || ''),
              inArray(messages.sendStatus, [SendStatus.PENDING, SendStatus.SENT]),
              isNotNull(messages.sendToken),
              // 30 minutes, measured from INGEST time. This only bounds the scan — it is
              // NOT the precision control. Precision comes from the `< 60000` relative-skew
              // check against `recentlySent.createdAt` below, plus the integration /
              // `sendToken` / subject predicates and `orderBy desc(createdAt)`.
              // The previous 5 minutes was too short: Outlook polls every ~5-7 minutes, and
              // a measured live case had our row created at 06:28:02.744 and the echo
              // ingested at 06:34:50 — a 6m47s gap, so the candidate was never even
              // SELECTED and the skew check never got to run.
              gte(messages.createdAt, new Date(Date.now() - 30 * 60 * 1000))
            ),
          orderBy: (messages, { desc }) => [desc(messages.createdAt)],
          columns: {
            id: true,
            sendToken: true,
            internetMessageId: true,
            threadId: true,
            createdAt: true,
          },
        })

    if (recentlySent) {
      // Verify it's likely the same message. Compare the echo's `sentAt` against the
      // candidate row's `createdAt` — NOT against `new Date()`. `new Date()` is the
      // moment of ingest, and the echo only arrives when the provider is next polled
      // (~3 minutes for Outlook), so the old comparison missed essentially every real
      // match. A missing `sentAt` yields a huge diff and simply does not match, which
      // is the safe direction.
      const timeDiff = Math.abs(
        (messageData.sentAt?.getTime() ?? 0) - recentlySent.createdAt.getTime()
      )

      if (timeDiff < 60000) {
        // Within 1 minute of the candidate's creation
        // Named for what it actually compares. It used to say "by subject/sender",
        // which sent every reader looking for a sender check that has never existed
        // — and made the SMS collapse above much harder to spot in the logs.
        logger.info('Found likely matching sent message by subject + time window', {
          messageId: recentlySent.id,
          subject: messageData.subject,
          timeDiffMs: timeDiff,
        })

        await this.mergeIncomingProviderData(recentlySent.id, messageData)
        return {
          isReconciled: true,
          existingMessageId: recentlySent.id,
        }
      }
    }

    // No match found - this is a genuinely new message
    return {
      isReconciled: false,
    }
  }

  /**
   * Merges provider data into an existing sent message
   */
  private async mergeIncomingProviderData(
    existingMessageId: string,
    providerData: MessageData
  ): Promise<void> {
    logger.info('Merging provider data into existing message', {
      messageId: existingMessageId,
      externalId: providerData.externalId,
    })

    const existing = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, existingMessageId),
      columns: { threadId: true, textPlain: true, textHtml: true, snippet: true },
    })

    // Update the message with provider data
    await this.db
      .update(schema.Message)
      .set({
        // Update with real provider IDs
        externalId: providerData.externalId,
        externalThreadId: providerData.externalThreadId,

        // Update status
        sendStatus: SendStatus.SENT,

        // Fill in any missing content — never overwrite what we composed. The provider's
        // Sent-folder copy carries the tracking pixel/wrapped links injected at send time;
        // the stored row must keep the clean HTML or the app UI would fire self-opens.
        textPlain: existing?.textPlain ? undefined : providerData.textPlain || undefined,
        textHtml: existing?.textHtml ? undefined : providerData.textHtml || undefined,
        snippet: existing?.snippet ? undefined : providerData.snippet || undefined,

        // Update timestamps
        sentAt: providerData.sentAt,
        receivedAt: providerData.receivedAt,

        // Provider-specific data
        historyId: providerData.historyId ? Number(providerData.historyId) : undefined,
        hasAttachments: providerData.hasAttachments,

        // Threading: `Message.inReplyTo` / `Message.references` were dropped in
        // migration 0028, so there is nowhere to store the provider's copies.
        // Outbound threading headers are re-derived from the thread's
        // `internetMessageId`s at send time (`MessageSenderService#getInReplyTo`),
        // and inbound ones stay in `metadata.headers` (see `ingest/store-message`).

        // Merge metadata
        metadata: {
          ...((providerData.metadata as any) || {}),
          reconciled: true,
          reconciledAt: new Date().toISOString(),
          reconciledFrom: 'incoming_sync',
        },
      })
      .where(eq(schema.Message.id, existingMessageId))

    // Update thread if needed
    const message = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, existingMessageId),
      columns: { threadId: true },
    })

    if (message?.threadId) {
      await this.threadManager.updateThreadMetadata(message.threadId)
    }

    // Promote thread externalId if it's a placeholder
    if (message?.threadId && providerData.externalThreadId) {
      const thread = await this.db.query.Thread.findFirst({
        where: (threads, { eq }) => eq(threads.id, message.threadId),
        columns: { externalId: true },
      })

      const ext = thread?.externalId
      if (
        !ext ||
        ext.startsWith('new_') ||
        ext.startsWith('pending_') ||
        ext.startsWith('draft_') ||
        (ext.includes('-') && ext.length === 36) // UUID
      ) {
        await this.db
          .update(schema.Thread)
          .set({
            externalId: providerData.externalThreadId,
          })
          .where(eq(schema.Thread.id, message.threadId))

        logger.info('Promoted thread externalId from placeholder', {
          threadId: message.threadId,
          oldExternalId: ext,
          newExternalId: providerData.externalThreadId,
        })
      }
    }
  }

  /**
   * Marks duplicate threads and messages for cleanup
   */
  private async markDuplicatesForCleanup(input: {
    realThreadId: string
    realMessageId: string
    externalThreadId: string
    externalMessageId: string
  }): Promise<void> {
    // Find any duplicate threads with same external ID
    const duplicateThreads = await this.db.query.Thread.findMany({
      where: (threads, { eq, and, not }) =>
        and(
          eq(threads.organizationId, this.organizationId),
          eq(threads.externalId, input.externalThreadId),
          not(eq(threads.id, input.realThreadId))
        ),
      columns: { id: true },
    })

    if (duplicateThreads.length > 0) {
      logger.warn('Found duplicate threads to clean up', {
        realThreadId: input.realThreadId,
        duplicates: duplicateThreads.map((t) => t.id),
      })

      // Mark threads for cleanup (add to metadata)
      for (const thread of duplicateThreads) {
        await this.db
          .update(schema.Thread)
          .set({
            metadata: {
              markedForCleanup: true,
              cleanupReason: 'duplicate_after_send',
              realThreadId: input.realThreadId,
              markedAt: new Date().toISOString(),
            },
          })
          .where(eq(schema.Thread.id, thread.id))
      }
    }

    // Find any duplicate messages
    const duplicateMessages = await this.db.query.Message.findMany({
      where: (messages, { eq, and, not }) =>
        and(
          eq(messages.organizationId, this.organizationId),
          eq(messages.externalId, input.externalMessageId),
          not(eq(messages.id, input.realMessageId))
        ),
      columns: { id: true },
    })

    if (duplicateMessages.length > 0) {
      logger.warn('Found duplicate messages to clean up', {
        realMessageId: input.realMessageId,
        duplicates: duplicateMessages.map((m) => m.id),
      })

      // Delete duplicate messages
      await this.db.delete(schema.Message).where(
        inArray(
          schema.Message.id,
          duplicateMessages.map((m) => m.id)
        )
      )

      // Recalculate thread metadata after deleting duplicates
      await this.threadManager.updateThreadMetadata(input.realThreadId)
    }
  }

  /**
   * Checks if a message is pending send (for idempotency)
   */
  async isPendingSend(sendToken: string): Promise<boolean> {
    const existing = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.sendToken, sendToken),
      columns: {
        id: true,
        sendStatus: true,
      },
    })

    return existing?.sendStatus === SendStatus.PENDING
  }

  /**
   * Gets the status of a sent message
   */
  async getSendStatus(messageId: string): Promise<{
    status: string
    error?: string | null
    sentAt?: Date | null
  }> {
    const message = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, messageId),
      columns: {
        sendStatus: true,
        providerError: true,
        sentAt: true,
      },
    })

    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }

    return {
      status: message.sendStatus || SendStatus.PENDING,
      error: message.providerError,
      sentAt: message.sentAt,
    }
  }
}
