// packages/lib/src/messages/message-composer.service.ts

import { getAppHostname } from '@auxx/config/server'
import { type Database, schema, type Transaction } from '@auxx/database'
import { ParticipantRole, SendStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { convert as htmlToText } from 'html-to-text'
import { getOrgChannelProviderMap } from '../channels/cache'
import { getMessageTypeFromProvider } from '../providers/type-utils'
import { MessageType } from '../providers/types'
import { type FileAttachment, MessageAttachmentService } from './message-attachment.service'
import type { ComposedMessage, ProcessedParticipants } from './types/message-sending.types'

const logger = createScopedLogger('message-composer')

/**
 * Convert outbound HTML content to plain text for the `text/plain` MIME part.
 * Uses `html-to-text` (same library as the inbound IMAP extractor) to
 * preserve paragraph / line breaks and produce readable URL fallbacks.
 *
 * Options differ from inbound: we keep anchor hrefs (plain-text readers
 * should still see the link) and skip images.
 */
function outboundHtmlToText(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [{ selector: 'img', format: 'skip' }],
  })
}

/**
 * Upsert the thread-grained participant rollup for an outbound message, mirroring
 * `ingest/store-message.ts`.
 *
 * Without this an outbound-first thread has NO `ThreadParticipant` rows until
 * somebody replies. That matters because contact-derived mail sharing joins on
 * `ThreadParticipant.entityInstanceId` (`mail-query/visibility-scope.ts`), so a
 * thread you sent to a contact but that was never answered is invisible to
 * everyone whose access comes from a grant on that contact — it would appear only
 * once the customer replied and ingest wrote the rows.
 *
 * `ThreadManagerService.updateThreadParticipantCount` does not cover this: despite
 * its former name (`updateThreadParticipants`) it only ever wrote
 * `Thread.participantCount` and never touched this table. The name is why the gap
 * went unnoticed.
 *
 * **BCC is deliberately excluded.** A rollup row is an access-granting fact — it is
 * what lets a contact grant reach this thread — so including a blind-copied
 * recipient would hand that recipient's grantees the entire conversation, which
 * inverts what BCC means. Ingest never has to make this call: inbound mail carries
 * no BCC.
 */
export async function upsertOutboundThreadParticipants(
  tx: Transaction,
  threadId: string,
  participants: ProcessedParticipants,
  at: Date
): Promise<void> {
  const rows = [participants.from, ...participants.to, ...(participants.cc ?? [])]
    .filter((p) => !!p?.identifier)
    .map((p) => ({
      threadId,
      // Column is named `email` but holds the routing identifier — an E.164 number
      // on a phone channel. Same key ingest writes, so the unique index matches.
      email: p.identifier,
      name: p.name ?? null,
      entityInstanceId: p.entityInstanceId ?? null,
      isInternal: p.isInternal ?? false,
      messageCount: 1,
      // Outbound rows are written before the send lands, so `Message.sentAt` is
      // still null here; `at` is this message's own timestamp.
      firstMessageAt: at,
      lastMessageAt: at,
    }))
  if (rows.length === 0) return

  await tx
    .insert(schema.ThreadParticipant)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.ThreadParticipant.threadId, schema.ThreadParticipant.email],
      set: {
        messageCount: sql`${schema.ThreadParticipant.messageCount} + 1`,
        firstMessageAt: sql`LEAST(${schema.ThreadParticipant.firstMessageAt}, excluded."firstMessageAt")`,
        lastMessageAt: sql`GREATEST(${schema.ThreadParticipant.lastMessageAt}, excluded."lastMessageAt")`,
        // Prefer a freshly resolved contact link / name; keep the old one otherwise.
        entityInstanceId: sql`COALESCE(excluded."entityInstanceId", ${schema.ThreadParticipant.entityInstanceId})`,
        name: sql`COALESCE(excluded."name", ${schema.ThreadParticipant.name})`,
      },
    })
}

/**
 * Handles message composition and preparation for sending
 */
export class MessageComposerService {
  constructor(
    private organizationId: string,
    private db: Database
  ) {
    // Note: We'll need userId for MessageAttachmentService, will be passed in methods
  }

  /**
   * Composes a message for sending
   * Creates the database record in PENDING state
   */
  async composeMessage(input: {
    threadId: string
    userId: string
    organizationId: string
    integrationId: string
    messageId?: string // Optional pre-generated Message-ID
    /** Nullable — `Message.subject` is a nullable column; chat sends carry none. */
    subject?: string | null
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    draftMessageId?: string | null // @deprecated - ignored, drafts use separate Draft table
    keepAsDraft?: boolean // @deprecated - ignored, drafts use separate Draft table
    inReplyTo?: string | null
    references?: string | null
    attachmentIds?: string[] // MediaAsset IDs to attach
    /** §6 fix #3 — persisted so the per-thread alternation guard can read the last
     * outbound message's origin durably instead of re-deriving it at runtime. */
    isAutomatedSend?: boolean
  }): Promise<ComposedMessage> {
    const messageId = input.messageId || this.generateMessageId()
    const sendToken = this.generateSendToken()

    // @deprecated - keepAsDraft / promoteDraftToPending used the old Message-table drafts.
    // Drafts now live in the Draft table; the client passes all content fields on send,
    // so we always create a fresh PENDING message. Draft cleanup is handled client-side.

    // Create new message in PENDING state
    return this.createPendingMessage({
      ...input,
      messageId,
      sendToken,
    })
  }

  /**
   * Creates a new message in PENDING state
   */
  private async createPendingMessage(input: {
    threadId: string
    userId: string
    organizationId: string
    integrationId: string
    /** Nullable — `Message.subject` is a nullable column; chat sends carry none. */
    subject?: string | null
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    messageId: string
    sendToken: string
    inReplyTo?: string | null
    references?: string | null
    attachmentIds?: string[]
    isAutomatedSend?: boolean
  }): Promise<ComposedMessage> {
    logger.info('Creating pending message', {
      threadId: input.threadId,
      messageId: input.messageId,
      sendToken: input.sendToken,
    })

    const now = new Date()

    // Ensure we have plain text version
    const textPlain = input.textPlain || (input.textHtml ? outboundHtmlToText(input.textHtml) : '')

    // Get thread info
    const thread = await this.db.query.Thread.findFirst({
      where: (threads, { eq }) => eq(threads.id, input.threadId),
      columns: {
        externalId: true,
      },
    })

    if (!thread) {
      throw new Error(`Thread ${input.threadId} not found`)
    }

    // The composer only ever creates SMS/EMAIL/CHAT rows (message-type-overhaul
    // plan §3) — `PLATFORM_CAPABILITIES[provider].messageType` is "the type the
    // composer stamps on an outbound row". Read from the org cache rather than a
    // fresh query (org-cache-first house rule); an unresolved provider (channel
    // deleted between compose and send) falls back to EMAIL rather than throwing.
    const providerMap = await getOrgChannelProviderMap(input.organizationId, this.db)
    const composerProvider = providerMap.get(input.integrationId)
    const messageType = composerProvider
      ? getMessageTypeFromProvider(composerProvider)
      : MessageType.EMAIL

    // Create message with participants in a transaction
    const result = await this.db.transaction(async (tx: Transaction) => {
      // Create the message
      const [message] = await tx
        .insert(schema.Message)
        .values({
          // IDs and references
          threadId: input.threadId,
          organizationId: input.organizationId,
          integrationId: input.integrationId,
          // Note: integrationType removed - derived from Integration.provider
          messageType,
          createdById: input.userId,

          // Use placeholder external IDs that will be updated
          externalId: `pending_${input.sendToken}`,
          externalThreadId: thread.externalId ?? null,

          // Message identifiers
          internetMessageId: input.messageId,
          sendToken: input.sendToken,
          sendStatus: SendStatus.PENDING,

          // Content
          subject: input.subject,
          textHtml: input.textHtml,
          textPlain: textPlain,
          snippet: textPlain ? textPlain.slice(0, 280) : null,

          // Participants
          fromId: input.participants.from.id,

          // Signature
          signatureId: input.signatureId,

          // Timestamps
          createdAt: now,
          updatedAt: now,
          sentAt: null, // Will be set when actually sent

          // Flags
          isInbound: false,
          hasAttachments: input.attachmentIds && input.attachmentIds.length > 0,
          isAutomatedSend: input.isAutomatedSend ?? false,

          // Initialize send tracking
          attempts: 0,
          lastAttemptAt: null,
          providerError: null,
        })
        .returning()

      if (!message) {
        throw new Error('No message created')
      }
      // Create MessageParticipant links
      const participantLinks = [
        // From
        {
          messageId: message.id,
          participantId: input.participants.from.id,
          role: ParticipantRole.FROM,
        },
        // To
        ...input.participants.to.map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.TO,
        })),
        // CC
        ...(input.participants.cc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.CC,
        })),
        // BCC
        ...(input.participants.bcc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.BCC,
        })),
      ]

      await tx.insert(schema.MessageParticipant).values(participantLinks).onConflictDoNothing()

      await upsertOutboundThreadParticipants(tx, input.threadId, input.participants, now)

      // Update thread latestMessageId
      // All messages are now "real" messages - drafts are in separate Draft table
      await tx
        .update(schema.Thread)
        .set({ latestMessageId: message.id })
        .where(eq(schema.Thread.id, input.threadId))

      // Note: Attachments will be linked outside transaction using MessageAttachmentService

      return message
    })

    // Link attachments after transaction using MessageAttachmentService
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      const messageAttachmentService = new MessageAttachmentService(
        input.organizationId,
        input.userId,
        this.db
      )
      // Detect actual types and friendly names for each ID
      const fileAttachments = await this.detectAttachmentTypes(
        input.attachmentIds,
        input.organizationId
      )
      if (fileAttachments.length > 0) {
        await messageAttachmentService.linkFilesToMessage(result.id, fileAttachments)
      }
    }

    return {
      id: result.id,
      messageId: input.messageId,
      sendToken: input.sendToken,
      threadId: input.threadId,
      subject: input.subject,
      textHtml: input.textHtml,
      textPlain: textPlain,
      references: input.references,
      inReplyTo: input.inReplyTo,
      participantIds: input.participants.all.map((p) => p.id),
    }
  }

  /**
   * Detect whether provided IDs are MediaAssets or FolderFiles and build FileAttachment entries.
   * Keeps input order; falls back to generic names when metadata is missing.
   */
  private async detectAttachmentTypes(
    ids: string[],
    organizationId: string
  ): Promise<FileAttachment[]> {
    const results: FileAttachment[] = []

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      if (id === undefined) continue
      // Try MediaAsset first
      const asset = await this.db.query.MediaAsset.findFirst({
        where: (assets, { eq, and }) =>
          and(eq(assets.id, id), eq(assets.organizationId, organizationId)),
        columns: { id: true, name: true },
      })
      if (asset) {
        results.push({
          id,
          name: asset.name || `attachment-${i + 1}`,
          type: 'asset',
        })
        continue
      }

      // Try FolderFile
      const file = await this.db.query.FolderFile.findFirst({
        where: (files, { eq, and }) =>
          and(eq(files.id, id), eq(files.organizationId, organizationId)),
        columns: { id: true, name: true },
      })
      if (file) {
        results.push({
          id,
          name: file.name || `attachment-${i + 1}`,
          type: 'file',
        })
        continue
      }

      // Neither found: skip with a warning
      logger.warn('Attachment ID not found in asset or file tables; skipping', { id })
    }

    return results
  }

  /**
   * Updates an existing draft message without promoting to pending
   */
  private async updateExistingDraft(input: {
    draftMessageId: string
    userId: string
    organizationId: string
    threadId: string
    /** Nullable — `Message.subject` is a nullable column; chat sends carry none. */
    subject?: string | null
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    messageId: string
    sendToken: string
    inReplyTo?: string | null
    references?: string | null
  }): Promise<ComposedMessage> {
    // @deprecated - This method is deprecated. Drafts are now stored in separate Draft table.
    logger.info('Updating existing draft', {
      draftMessageId: input.draftMessageId,
      messageId: input.messageId,
    })

    const now = new Date()

    // Ensure we have plain text version
    const textPlain = input.textPlain || (input.textHtml ? outboundHtmlToText(input.textHtml) : '')

    // Update the draft message
    const result = await this.db.transaction(async (tx) => {
      // Update the draft
      const [message] = await tx
        .update(schema.Message)
        .set({
          // Update content
          subject: input.subject,
          textHtml: input.textHtml,
          textPlain: textPlain,
          snippet: textPlain ? textPlain.slice(0, 280) : null,

          // NOTE: `Message.inReplyTo` / `Message.references` were dropped in
          // migration 0028 and are NOT persisted. RFC threading headers are
          // re-derived at send time from the thread's `internetMessageId`s
          // (`MessageSenderService#getInReplyTo` / `#getReferences`), so
          // `input.inReplyTo` / `input.references` only ride out on the returned
          // `ComposedMessage`.

          // Update signature
          signatureId: input.signatureId,

          // Update timestamps
          updatedAt: now,

          // Update participants
          fromId: input.participants.from.id,
        })
        .where(
          and(
            eq(schema.Message.id, input.draftMessageId),
            eq(schema.Message.createdById, input.userId),
            eq(schema.Message.organizationId, input.organizationId)
          )
        )
        .returning()

      if (!message) throw new Error('no message')

      // Update participants - first delete existing ones
      await tx
        .delete(schema.MessageParticipant)
        .where(eq(schema.MessageParticipant.messageId, message.id))

      const participantLinks = [
        // From
        {
          messageId: message.id,
          participantId: input.participants.from.id,
          role: ParticipantRole.FROM,
        },
        // To
        ...input.participants.to.map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.TO,
        })),
        // CC
        ...(input.participants.cc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.CC,
        })),
        // BCC
        ...(input.participants.bcc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.BCC,
        })),
      ]

      await tx.insert(schema.MessageParticipant).values(participantLinks).onConflictDoNothing()

      await upsertOutboundThreadParticipants(tx, input.threadId, input.participants, now)

      return message
    })

    return {
      id: result.id,
      messageId: input.messageId,
      sendToken: input.sendToken,
      threadId: input.threadId,
      subject: input.subject,
      textHtml: input.textHtml,
      textPlain: textPlain,
      references: input.references,
      inReplyTo: input.inReplyTo,
      participantIds: input.participants.all.map((p) => p.id),
    }
  }

  /**
   * Promotes a draft message to PENDING send state
   */
  private async promoteDraftToPending(input: {
    draftMessageId: string
    userId: string
    organizationId: string
    threadId: string
    /** Nullable — `Message.subject` is a nullable column; chat sends carry none. */
    subject?: string | null
    textHtml?: string | null
    textPlain?: string | null
    participants: ProcessedParticipants
    signatureId?: string | null
    messageId: string
    sendToken: string
    inReplyTo?: string | null
    references?: string | null
  }): Promise<ComposedMessage> {
    // @deprecated - This method is deprecated. Drafts are now stored in separate Draft table.
    logger.info('Promoting draft to pending', {
      draftMessageId: input.draftMessageId,
      messageId: input.messageId,
      sendToken: input.sendToken,
    })

    const now = new Date()

    // Ensure we have plain text version
    const textPlain = input.textPlain || (input.textHtml ? outboundHtmlToText(input.textHtml) : '')

    // First check what draft actually exists
    const existingDraft = await this.db.query.Message.findFirst({
      where: (messages, { eq }) => eq(messages.id, input.draftMessageId),
      columns: {
        id: true,
        createdById: true,
        organizationId: true,
        sendStatus: true,
      },
    })

    if (!existingDraft) {
      throw new Error(`Draft message ${input.draftMessageId} not found`)
    }

    logger.info('Draft found for promotion', {
      draftMessageId: input.draftMessageId,
      existingDraft,
    })

    // Update the draft message to pending state
    const result = await this.db.transaction(async (tx) => {
      // Update the draft
      const [message] = await tx
        .update(schema.Message)
        .set({
          // Update identifiers
          internetMessageId: input.messageId,
          sendToken: input.sendToken,
          sendStatus: SendStatus.PENDING,

          // Clear draft external IDs
          externalId: null,
          externalThreadId: null,

          // Update content
          subject: input.subject,
          textHtml: input.textHtml,
          textPlain: textPlain,
          snippet: textPlain ? textPlain.slice(0, 280) : null,

          // NOTE: `inReplyTo` / `references` are not columns — see the comment in
          // `updateExistingDraft`. They travel on the returned `ComposedMessage`.

          // Update signature
          signatureId: input.signatureId,

          // Update timestamps
          updatedAt: now,

          // Reset send tracking
          attempts: 0,
          lastAttemptAt: null,
          providerError: null,
        })
        .where(
          and(
            eq(schema.Message.id, input.draftMessageId),
            eq(schema.Message.createdById, input.userId),
            eq(schema.Message.organizationId, input.organizationId)
          )
        )
        .returning()

      if (!message) throw new Error('No message')

      // Update participants - first delete existing ones
      await tx
        .delete(schema.MessageParticipant)
        .where(eq(schema.MessageParticipant.messageId, message.id))

      const participantLinks = [
        // From
        {
          messageId: message.id,
          participantId: input.participants.from.id,
          role: ParticipantRole.FROM,
        },
        // To
        ...input.participants.to.map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.TO,
        })),
        // CC
        ...(input.participants.cc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.CC,
        })),
        // BCC
        ...(input.participants.bcc || []).map((p) => ({
          messageId: message.id,
          participantId: p.id,
          role: ParticipantRole.BCC,
        })),
      ]

      await tx.insert(schema.MessageParticipant).values(participantLinks).onConflictDoNothing()

      await upsertOutboundThreadParticipants(tx, input.threadId, input.participants, now)

      // Update thread latestMessageId
      // All messages are now "real" messages - drafts are in separate Draft table
      await tx
        .update(schema.Thread)
        .set({ latestMessageId: message.id })
        .where(eq(schema.Thread.id, input.threadId))

      return message
    })

    return {
      id: result.id,
      messageId: input.messageId,
      sendToken: input.sendToken,
      threadId: input.threadId,
      subject: input.subject,
      textHtml: input.textHtml,
      textPlain: textPlain,
      references: input.references,
      inReplyTo: input.inReplyTo,
      participantIds: input.participants.all.map((p) => p.id),
    }
  }

  /**
   * Generates an RFC-compliant Message-ID
   * Format: <auxx.timestamp.uuid@auxx.ai>
   */
  private generateMessageId(): string {
    const timestamp = Date.now()
    const uuid = crypto.randomUUID()
    return `<auxx.${timestamp}.${uuid}@${getAppHostname()}>`
  }

  /**
   * Generates a unique send token for idempotency
   */
  private generateSendToken(): string {
    return crypto.randomUUID()
  }

  /**
   * Appends signature to message body.
   * Signatures live as EntityInstance(entityType='signature') with the body
   * stored as a FieldValue keyed by CustomField.systemAttribute='signature_body'.
   */
  async appendSignature(
    content: { html?: string | null; plain?: string | null },
    signatureId: string,
    _userId: string
  ): Promise<{ html?: string | null; plain?: string | null }> {
    if (!signatureId) return content

    const [row] = await this.db
      .select({ body: schema.FieldValue.valueText })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.CustomField,
        and(
          eq(schema.CustomField.entityDefinitionId, schema.EntityInstance.entityDefinitionId),
          eq(schema.CustomField.systemAttribute, 'signature_body')
        )
      )
      .innerJoin(
        schema.FieldValue,
        and(
          eq(schema.FieldValue.entityId, schema.EntityInstance.id),
          eq(schema.FieldValue.fieldId, schema.CustomField.id)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.id, signatureId),
          eq(schema.EntityInstance.organizationId, this.organizationId)
        )
      )
      .limit(1)

    const body = row?.body
    if (!body) return content

    return {
      html: content.html ? `${content.html}${body}` : body,
      plain: content.plain
        ? `${content.plain}\n${outboundHtmlToText(body)}`
        : outboundHtmlToText(body),
    }
  }
}
