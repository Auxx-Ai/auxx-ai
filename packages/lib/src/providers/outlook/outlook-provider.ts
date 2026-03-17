// src/lib/providers/outlook/outlook-provider.ts // Adjusted path

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import type { IntegrationEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getAttachmentByteSize, sanitizeFilename, toGraphRecipients } from '@auxx/utils'
import {
  type Client,
  type PageCollection,
  PageIterator,
  type PageIteratorCallback,
} from '@microsoft/microsoft-graph-client'
import { and, eq } from 'drizzle-orm'
import {
  EmailLabel, // Still needed for MessageData structure
  type MessageData, // Use this structure for storing
  MessageStorageService,
  type ParticipantInputData, // Use this for participant info
} from '../../email/email-storage' // Adjust path
import {
  type ChannelProvider,
  type MessageListResult,
  MessageStatus,
  type SendMessageOptions,
} from '../channel-provider.interface' // Adjust path
import { ChannelTokenAccessor } from '../channel-token-accessor'
import {
  type AttachmentFile,
  BaseMessageProvider,
  type MessageProvider,
} from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'
import { parseGraphApiError } from './outlook-errors'
import { OutlookInboundContentIngestor } from './outlook-inbound-content-ingestor'
import {
  type OutlookClientContext,
  type OutlookIntegrationMetadata,
  OutlookOAuthService,
} from './outlook-oauth'

const logger = createScopedLogger('outlook-provider')

/** Microsoft Graph /$batch endpoint limit. */
const GRAPH_BATCH_LIMIT = 20
const OUTLOOK_MAX_PAGE_SIZE = 999
const IMMUTABLE_ID_PREFER = `odata.maxpagesize=${OUTLOOK_MAX_PAGE_SIZE}, IdType="ImmutableId"`
// Interface for Graph API email address structure
interface GraphEmailAddress {
  name?: string
  address: string
}
// Interface for Graph API recipient structure
interface GraphRecipient {
  emailAddress: GraphEmailAddress
}
// Interface for Graph API message structure (simplified)
interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  bodyPreview?: string
  body?: {
    contentType?: 'text' | 'html'
    content?: string
  }
  from?: GraphRecipient
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
  bccRecipients?: GraphRecipient[]
  replyTo?: GraphRecipient[]
  receivedDateTime?: string
  sentDateTime?: string
  internetMessageId?: string
  parentFolderId?: string
  isRead?: boolean
  hasAttachments?: boolean
  categories?: string[] // Used as keywords/tags
  internetMessageHeaders?: Array<{
    name: string
    value: string
  }>
  inferenceClassification?: string // e.g., 'focused' or 'other'
}
// Mapping from internal status to Outlook folder/actions (approximate)
/*
const outlookStatusMap: Record<
  MessageStatus,
  { folder?: string; isRead?: boolean; categories?: string[] }
> = {
  [MessageStatus.READ]: { isRead: true },
  [MessageStatus.UNREAD]: { isRead: false },
  [MessageStatus.IMPORTANT]: {
    // Maps to Importance High?
  },
  [MessageStatus.STARRED]: {
    // Maps to Flagged?
  },
  [MessageStatus.ARCHIVED]: { folder: 'archive' }, // Common well-known name
  [MessageStatus.SPAM]: { folder: 'junkemail' }, // Common well-known name
  [MessageStatus.TRASH]: { folder: 'deleteditems' }, // Common well-known name
}
*/
export class OutlookProvider
  extends BaseMessageProvider
  implements ChannelProvider, MessageProvider
{
  private client: Client | null = null
  private inboxId: string | undefined = undefined // Optional: Store inbox ID if needed
  // Store the full integration record locally after initialization
  private integration:
    | (IntegrationEntity & {
        inboxIntegration?: any
      })
    | null = null
  private storageService: MessageStorageService
  constructor(organizationId: string) {
    super(IntegrationProviderType.outlook, '', organizationId)
    this.storageService = new MessageStorageService(organizationId)
  }
  /**
   * Get provider capabilities for Outlook/Office 365
   */
  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.outlook)
  }
  /**
   * Initializes the Outlook provider for a specific integration.
   */
  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing OutlookProvider for integration: ${integrationId}`)
    ;(this as any).integrationId = integrationId
    const [dbIntegrationData] = await db
      .select({
        integration: schema.Integration,
        inboxIntegration: schema.InboxIntegration,
      })
      .from(schema.Integration)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Integration.id)
      )
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    const dbIntegration = dbIntegrationData
      ? {
          ...dbIntegrationData.integration,
          inboxIntegration: dbIntegrationData.inboxIntegration,
        }
      : null
    // Validate integration data
    if (!dbIntegration || dbIntegration.provider !== 'outlook' || !dbIntegration.enabled) {
      this.resetState()
      throw new Error(
        `Active Outlook integration not found or not enabled for ID: ${integrationId}`
      )
    }
    this.inboxId = dbIntegration?.inboxIntegration?.inboxId
    // Store the integration data locally
    this.integration = dbIntegration

    // Get tokens from encrypted credentials
    const tokens = await ChannelTokenAccessor.getTokens(integrationId)
    if (!tokens.refreshToken) {
      this.resetState()
      throw new Error(`Missing refresh token for Outlook integration ID: ${integrationId}`)
    }

    const metadata = dbIntegration.metadata as unknown as Partial<OutlookIntegrationMetadata>

    const clientCtx: OutlookClientContext = {
      integrationId: dbIntegration.id,
      organizationId: this.organizationId,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      homeAccountId: metadata?.homeAccountId,
      email: metadata?.email || '',
    }
    this.client = await OutlookOAuthService.getAuthenticatedClient(clientCtx)
    logger.info(`OutlookProvider initialized successfully for integration: ${integrationId}`)
  }
  /** Resets internal state */
  private resetState(): void {
    this.inboxId = undefined
    this.integrationId = null
    this.integration = null
    this.client = null
  }
  /** Ensures the provider is initialized */
  private async ensureInitialized(): Promise<void> {
    if (!this.client || !this.integrationId || !this.integration) {
      if (this.integrationId) {
        logger.warn(`Re-initializing Outlook provider for ${this.integrationId}`)
        await this.initialize(this.integrationId)
      } else {
        throw new Error('OutlookProvider not initialized with an integration ID.')
      }
    }
    // Optional: Add token validity check if needed, though the authProvider should handle it.
  }
  /** Helper to extract participant data from Graph API recipient structure */
  private graphRecipientToParticipantInput(
    recipient?: GraphRecipient | null
  ): ParticipantInputData | null {
    if (!recipient?.emailAddress?.address) {
      return null
    }
    return {
      identifier: recipient.emailAddress.address,
      name: recipient.emailAddress.name,
      // raw: // Graph API usually doesn't provide the raw string easily
    }
  }
  /**
   * Upload session for large attachments
   */
  private async uploadLargeAttachment(
    messageId: string,
    attachment: AttachmentFile,
    isInline: boolean = false
  ): Promise<void> {
    const size = getAttachmentByteSize(attachment)
    logger.info(`Starting upload session for large attachment`, {
      filename: attachment.filename,
      sizeBytes: size,
      messageId,
    })
    // Create upload session
    const sessionResponse = await this.client!.api(
      `/me/messages/${messageId}/attachments/createUploadSession`
    ).post({
      attachmentItem: {
        attachmentType: 'file',
        name: attachment.filename,
        size: size,
        contentType: attachment.contentType || 'application/octet-stream',
        isInline: isInline,
      },
    })
    const uploadUrl = sessionResponse.uploadUrl
    // Upload in chunks (3MB max per chunk for Graph API)
    const CHUNK_SIZE = 3 * 1024 * 1024 // 3MB chunks
    const content = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content)
    let offset = 0
    while (offset < size) {
      const chunkSize = Math.min(CHUNK_SIZE, size - offset)
      const chunk = content.slice(offset, offset + chunkSize)
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': chunkSize.toString(),
          'Content-Range': `bytes ${offset}-${offset + chunkSize - 1}/${size}`,
          'Content-Type': 'application/octet-stream',
        },
        body: chunk,
      })
      if (!response.ok) {
        throw new Error(`Upload chunk failed: ${response.status} ${response.statusText}`)
      }
      offset += chunkSize
      logger.debug(`Uploaded chunk for ${attachment.filename}`, {
        progress: `${offset}/${size}`,
        percentComplete: Math.round((offset / size) * 100),
      })
    }
    logger.info(`Large attachment uploaded successfully`, {
      filename: attachment.filename,
      sizeBytes: size,
    })
  }
  /**
   * Sends an email message using the Microsoft Graph API.
   */
  async sendMessage(options: SendMessageOptions): Promise<{
    id?: string
    success: boolean
  }> {
    await this.ensureInitialized()
    try {
      // Ensure contacts exist for recipients in selective mode
      const recipients = [
        ...(Array.isArray(options.to) ? options.to : [options.to]),
        ...(options.cc || []),
        ...(options.bcc || []),
      ].filter(Boolean)
      if (recipients.length > 0 && this.organizationId) {
        await this.storageService.ensureContactsForRecipients(
          recipients,
          this.organizationId,
          IntegrationProviderType.outlook
        )
      }
      // Format recipients for Graph API
      const toRecipients: GraphRecipient[] = toGraphRecipients(
        Array.isArray(options.to) ? options.to : [options.to]
      )
      // Use typed cc/bcc fields directly (not metadata)
      const ccRecipients: GraphRecipient[] = toGraphRecipients(options.cc || [])
      const bccRecipients: GraphRecipient[] = toGraphRecipients(options.bcc || [])
      const replyTo: GraphRecipient[] = toGraphRecipients(options.replyTo || [])
      // Create base message
      const message: any = {
        subject: options.subject || '(No Subject)',
        body: {
          contentType: options.html ? 'html' : 'text',
          content: options.html || options.text || '',
        },
        toRecipients: toRecipients,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
        replyTo: replyTo.length > 0 ? replyTo : undefined,
        importance: 'normal',
        internetMessageHeaders: [],
      }
      // Add threading headers (but note: these don't guarantee threading in Outlook)
      if (options.inReplyTo) {
        message.internetMessageHeaders.push({
          name: 'In-Reply-To',
          value: options.inReplyTo,
        })
      }
      if (options.references) {
        message.internetMessageHeaders.push({
          name: 'References',
          value: options.references,
        })
      }
      // Add custom headers
      message.internetMessageHeaders.push({
        name: 'X-AuxxAi-Message',
        value: 'true',
      })
      // IMPORTANT: For proper reply threading, consider using:
      // - conversationId if available
      // - Or use /reply endpoint instead of /sendMail for replies
      // This is a known Outlook limitation - headers alone don't guarantee threading
      // Handle attachments with size-aware logic
      if (options.attachments && options.attachments.length > 0) {
        const _MAX_INLINE_SIZE = 3 * 1024 * 1024 // 3MB for inline attachments
        const MAX_TOTAL_SIZE = 10 * 1024 * 1024 // 10MB total for standard send
        const MAX_SINGLE_INLINE = 3 * 1024 * 1024 // 3MB per inline attachment
        // Calculate sizes
        let totalSize = 0
        const attachmentInfo = options.attachments.map((att) => {
          const size = getAttachmentByteSize(att)
          totalSize += size
          return { attachment: att, size }
        })
        // Validate total size
        if (totalSize > MAX_TOTAL_SIZE) {
          throw new Error(
            `Total attachment size (${(totalSize / 1024 / 1024).toFixed(2)}MB) ` +
              `exceeds Outlook limit (10MB). Please use OneDrive for large files.`
          )
        }
        // Separate small and large attachments
        const smallAttachments = attachmentInfo.filter((a) => a.size <= MAX_SINGLE_INLINE)
        const largeAttachments = attachmentInfo.filter((a) => a.size > MAX_SINGLE_INLINE)
        // Process small attachments inline
        if (smallAttachments.length > 0) {
          message.attachments = smallAttachments.map(({ attachment }) => {
            const contentBuffer = Buffer.isBuffer(attachment.content)
              ? attachment.content
              : Buffer.from(attachment.content)
            const sanitizedName = sanitizeFilename(attachment.filename)
            return {
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: sanitizedName,
              contentType: attachment.contentType || 'application/octet-stream',
              contentBytes: contentBuffer.toString('base64'),
              isInline: attachment.inline || false,
              contentId: attachment.contentId,
            }
          })
        }
        // Handle large attachments via upload sessions
        if (largeAttachments.length > 0) {
          // First, create the message as a draft
          const draftResponse = await this.client!.api('/me/messages').post(message)
          const messageId = draftResponse.id
          // Upload large attachments
          for (const { attachment } of largeAttachments) {
            await this.uploadLargeAttachment(messageId, attachment, attachment.inline || false)
          }
          // Send the draft with all attachments
          await this.client!.api(`/me/messages/${messageId}/send`).post({})
          logger.info('Message with large attachments sent successfully', {
            messageId,
            smallAttachments: smallAttachments.length,
            largeAttachments: largeAttachments.length,
            totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
          })
          return { id: messageId, success: true }
        }
      }
      // Send message (no large attachments path)
      await this.client!.api('/me/sendMail').post({
        message: message,
        saveToSentItems: true,
      })
      // Structured logging
      logger.info('Message sent successfully via Outlook Graph API', {
        integrationId: this.integrationId,
        to: Array.isArray(options.to) ? options.to : [options.to],
        cc: options.cc || [],
        bcc: options.bcc || [],
        hasAttachments: !!(options.attachments && options.attachments.length > 0),
        attachmentCount: options.attachments?.length || 0,
        totalSizeBytes:
          options.attachments?.reduce(
            (sum, a) => sum + (a.size || Buffer.byteLength(a.content)),
            0
          ) || 0,
      })
      return { id: undefined, success: true }
    } catch (error: any) {
      const status = error.statusCode || error.status || 'unknown'
      const isAttachmentError =
        error.message?.includes('attachment') || error.message?.includes('size')
      logger.error(`Error sending message via Outlook API`, {
        status,
        error: error.message,
        body: error.body,
        integrationId: this.integrationId,
        hasAttachments: !!(options.attachments && options.attachments.length > 0),
        isAttachmentError,
      })
      // Normalize errors for UI
      if (status === 413 || error.message?.includes('RequestEntityTooLarge')) {
        throw new Error(
          `Message too large for Outlook. Try removing some attachments or ` +
            `using OneDrive links for large files.`
        )
      }
      if (isAttachmentError) {
        throw new Error(
          `Failed to send message with attachments: ${error.message}. ` +
            `Consider using OneDrive for files larger than 3MB.`
        )
      }
      throw new Error(`Failed to send Outlook message: ${error.message}`)
    }
  }
  /** Sets up webhooks (subscriptions) for Microsoft Graph notifications. */
  async setupWebhook(callbackUrl: string): Promise<void> {
    await this.ensureInitialized()
    const webhookSecret =
      (this.integration?.metadata as any)?.webhookSecret ||
      configService.get<string>('OUTLOOK_WEBHOOK_SECRET') ||
      crypto.randomBytes(20).toString('hex') // Use stored or fallback/generate secret
    const subscriptionPayload = {
      changeType: 'created,updated', // Notify on new and potentially updated messages
      notificationUrl: callbackUrl,
      resource: "/me/mailFolders('inbox')/messages", // Watch inbox messages (adjust resource as needed)
      expirationDateTime: new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000 - 15 * 60 * 1000
      ).toISOString(), // ~3 days minus buffer
      clientState: webhookSecret, // Use a secret to verify callbacks
    }
    try {
      logger.info('Attempting to create/update Microsoft Graph subscription...', {
        integrationId: this.integrationId,
        resource: subscriptionPayload.resource,
      })
      // Try to find existing subscription to update, otherwise create
      const currentSubscriptionId = (this.integration?.metadata as any)?.graphSubscriptionId
      let response: any
      if (currentSubscriptionId) {
        logger.debug(`Attempting to update existing subscription ${currentSubscriptionId}`)
        // Update requires only expirationDateTime usually
        response = await this.client!.api(`/subscriptions/${currentSubscriptionId}`).patch({
          expirationDateTime: subscriptionPayload.expirationDateTime,
        })
        logger.info(`Microsoft Graph subscription updated successfully.`, {
          subscriptionId: response.id,
        })
      } else {
        logger.debug(`Creating new subscription.`)
        response = await this.client!.api('/subscriptions').post(subscriptionPayload)
        logger.info('Microsoft Graph subscription created successfully.', {
          subscriptionId: response.id,
        })
      }
      // Store/update subscription ID and potentially the secret used in metadata
      if (
        (this.integrationId &&
          (this.integration?.metadata as any)?.graphSubscriptionId !== response.id) ||
        (this.integration?.metadata as any)?.webhookSecret !== webhookSecret
      ) {
        const updatedMetadata = {
          ...(this.integration?.metadata || {}),
          graphSubscriptionId: response.id,
          webhookSecret: webhookSecret, // Store the secret used
        }
        await db
          .update(schema.Integration)
          .set({ metadata: updatedMetadata as any })
          .where(eq(schema.Integration.id, this.integrationId))
        // Update local cache
        if (this.integration) this.integration.metadata = updatedMetadata as any
        logger.debug('Updated subscription ID and secret in integration metadata.')
      }
    } catch (error: any) {
      logger.error('Error creating/updating Microsoft Graph subscription:', {
        error: error.message,
        statusCode: error.statusCode,
        body: error.body,
        integrationId: this.integrationId,
      })
      throw new Error(`Failed to set up Outlook webhook: ${error.message}`)
    }
  }
  /** Removes Microsoft Graph webhooks (subscriptions). */
  async removeWebhook(): Promise<void> {
    await this.ensureInitialized()
    const subscriptionId = (this.integration?.metadata as any)?.graphSubscriptionId
    if (!subscriptionId) {
      logger.warn('No stored Microsoft Graph subscription ID found to remove.', {
        integrationId: this.integrationId,
      })
      return
    }
    try {
      logger.info(`Attempting to delete Microsoft Graph subscription: ${subscriptionId}`, {
        integrationId: this.integrationId,
      })
      await this.client!.api(`/subscriptions/${subscriptionId}`).delete()
      logger.info('Microsoft Graph subscription deleted successfully.', { subscriptionId })
      // Clear stored subscription ID from metadata
      if (this.integrationId) {
        const updatedMetadata = { ...(this.integration?.metadata || {}) }
        delete (updatedMetadata as any).graphSubscriptionId // Remove the key
        await db
          .update(schema.Integration)
          .set({ metadata: updatedMetadata as any })
          .where(eq(schema.Integration.id, this.integrationId))
        if (this.integration) this.integration.metadata = updatedMetadata as any // Update local cache
        logger.debug('Cleared subscription ID from integration metadata.')
      }
    } catch (error: any) {
      if (error.statusCode === 404) {
        logger.warn('MS Graph subscription not found during deletion (already deleted/expired?).', {
          subscriptionId,
        })
        // Clear stored ID anyway
        if (this.integrationId) {
          const updatedMetadata = { ...(this.integration?.metadata || {}) }
          delete (updatedMetadata as any).graphSubscriptionId
          await db
            .update(schema.Integration)
            .set({ metadata: updatedMetadata as any })
            .where(eq(schema.Integration.id, this.integrationId))
            .catch((dbErr) => logger.error('Failed to clear subscriptionId after 404', { dbErr }))
          if (this.integration) this.integration.metadata = updatedMetadata as any
        }
      } else {
        logger.error('Error deleting Microsoft Graph subscription:', {
          error: error.message,
          statusCode: error.statusCode,
          body: error.body,
          subscriptionId,
        })
        // Don't throw during cleanup? Optional.
        // throw new Error(`Failed to remove Outlook webhook: ${error.message}`);
      }
    }
  }
  /**
   * Synchronizes messages from Outlook using Microsoft Graph delta queries.
   * Uses PageIterator for pagination, ImmutableId for stable IDs, and handles 410 (expired delta link).
   */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()
    logger.info('Starting Outlook sync', {
      integrationId: this.integrationId,
      since: since?.toISOString(),
    })
    try {
      const storedDeltaLink = (this.integration?.metadata as any)?.graphDeltaLink
      const selectFields =
        'id,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,body,internetMessageId,parentFolderId,isRead,hasAttachments,categories,internetMessageHeaders,inferenceClassification'

      let url: string
      if (storedDeltaLink && !since) {
        logger.info('Resuming sync using stored deltaLink.', { integrationId: this.integrationId })
        url = storedDeltaLink
      } else {
        const dateFilter = since ? `&$filter=receivedDateTime ge ${since.toISOString()}` : ''
        url = `/me/mailFolders/inbox/messages/delta?$select=${selectFields}${dateFilter}`
        logger.info(
          `Starting initial delta sync.${since ? ' Filtering since ' + since.toISOString() : ''}`,
          { integrationId: this.integrationId }
        )
      }

      let response: PageCollection
      try {
        response = await this.client!.api(url)
          .version('beta')
          .headers({ Prefer: IMMUTABLE_ID_PREFER })
          .get()
      } catch (error) {
        const parsed = parseGraphApiError(error)
        if (parsed.code === 'SYNC_CURSOR_ERROR') {
          logger.warn('Delta link expired for syncMessages, resetting cursor', {
            integrationId: this.integrationId,
          })
          const dateFilter = since ? `&$filter=receivedDateTime ge ${since.toISOString()}` : ''
          url = `/me/mailFolders/inbox/messages/delta?$select=${selectFields}${dateFilter}`
          response = await this.client!.api(url)
            .version('beta')
            .headers({ Prefer: IMMUTABLE_ID_PREFER })
            .get()
        } else {
          throw error
        }
      }

      const allMessages: GraphMessage[] = []
      const callback: PageIteratorCallback = (data) => {
        if (!data['@removed'] && data.id) {
          allMessages.push(data)
        }
        return true
      }

      const pageIterator = new PageIterator(this.client!, response, callback, {
        headers: { Prefer: IMMUTABLE_ID_PREFER },
      })

      await pageIterator.iterate()

      let totalMessagesProcessed = 0
      let hasRetriableFailures = false

      if (allMessages.length > 0) {
        const messageDataArray = this.convertMessagesToMessageData(allMessages)
        const ingestor = new OutlookInboundContentIngestor(this.organizationId, this.storageService)
        const result = await ingestor.storeBatchWithIngest(messageDataArray, {
          client: this.client!,
          integrationId: this.integrationId!,
        })
        totalMessagesProcessed = result.storedCount

        if (result.retriableFailures.length > 0) {
          hasRetriableFailures = true
          logger.warn('Retriable ingest failures — delta link will NOT advance', {
            count: result.retriableFailures.length,
            externalIds: result.failedExternalIds,
          })
        }

        logger.info(
          `Processed ${messageDataArray.length} messages, stored ${result.storedCount}.`,
          { integrationId: this.integrationId }
        )
      }

      // Delta cursor safety: only advance delta link when no retriable failures occurred
      const newDeltaLink = pageIterator.getDeltaLink()
      const effectiveDeltaLink = hasRetriableFailures ? storedDeltaLink : newDeltaLink

      if (effectiveDeltaLink && this.integrationId) {
        const updatedMetadata = {
          ...(this.integration?.metadata || {}),
          graphDeltaLink: effectiveDeltaLink,
        }
        await db
          .update(schema.Integration)
          .set({ metadata: updatedMetadata as any, lastSyncedAt: new Date() })
          .where(eq(schema.Integration.id, this.integrationId))
        if (this.integration) {
          this.integration.metadata = updatedMetadata as any
          this.integration.lastSyncedAt = new Date()
        }
      } else if (this.integrationId) {
        await db
          .update(schema.Integration)
          .set({ lastSyncedAt: new Date() })
          .where(eq(schema.Integration.id, this.integrationId))
        if (this.integration) this.integration.lastSyncedAt = new Date()
      }

      logger.info(`Outlook sync completed. Processed ${totalMessagesProcessed} messages/changes.`, {
        integrationId: this.integrationId,
      })
    } catch (error: any) {
      logger.error('Error syncing messages from Outlook:', {
        error: error.message,
        statusCode: error.statusCode,
        body: error.body,
        integrationId: this.integrationId,
      })
      if (this.integrationId) {
        await db
          .update(schema.Integration)
          .set({ lastSyncedAt: new Date() })
          .where(eq(schema.Integration.id, this.integrationId))
          .catch((updateErr) =>
            logger.error('Failed to update lastSyncedAt after Outlook sync error', { updateErr })
          )
        if (this.integration) this.integration.lastSyncedAt = new Date()
      }
      throw new Error(`Failed to sync Outlook messages: ${error.message}`)
    }
  }
  /** Converts Outlook Graph message objects to the application's MessageData format */
  private convertMessagesToMessageData(messages: GraphMessage[]): MessageData[] {
    return messages
      .map((message): MessageData | null => {
        try {
          if (!this.integrationId || !this.integration) {
            throw new Error('Provider state invalid during message conversion.')
          }
          // Extract participants
          const fromInput = this.graphRecipientToParticipantInput(message.from)
          const toInputs = (message.toRecipients || [])
            .map((r) => this.graphRecipientToParticipantInput(r))
            .filter((p): p is ParticipantInputData => p !== null)
          const ccInputs = (message.ccRecipients || [])
            .map((r) => this.graphRecipientToParticipantInput(r))
            .filter((p): p is ParticipantInputData => p !== null)
          const bccInputs = (message.bccRecipients || [])
            .map((r) => this.graphRecipientToParticipantInput(r))
            .filter((p): p is ParticipantInputData => p !== null)
          const replyToInputs = (message.replyTo || [])
            .map((r) => this.graphRecipientToParticipantInput(r))
            .filter((p): p is ParticipantInputData => p !== null)
          // Require 'from' participant
          if (!fromInput) {
            logger.warn(`Skipping message conversion: Missing 'from' address.`, {
              externalId: message.id,
            })
            return null
          }
          // Timestamps
          const sentAt = message.sentDateTime ? new Date(message.sentDateTime) : new Date() // Fallback needed
          const receivedAt = message.receivedDateTime ? new Date(message.receivedDateTime) : sentAt // Fallback to sentAt
          const createdTime = receivedAt // Use received time as creation time
          // Determine directionality — check primary email and aliases
          const metadata = this.integration.metadata as any
          const allAddresses = new Set<string>()
          if (metadata?.email) allAddresses.add(metadata.email.toLowerCase())
          for (const alias of metadata?.emailAliases ?? []) {
            allAddresses.add(alias.toLowerCase())
          }
          const senderEmail = fromInput.identifier?.toLowerCase()
          const isInbound = allAddresses.size > 0 ? !allAddresses.has(senderEmail || '') : true
          // Determine EmailLabel based on standard folder names (case-insensitive check might be needed)
          let _emailLabel = EmailLabel.inbox // Default
          const folderIdLower = message.parentFolderId?.toLowerCase()
          if (folderIdLower === 'sentitems' || folderIdLower?.includes('sent')) {
            // Simple checks
            _emailLabel = EmailLabel.sent
          } else if (folderIdLower === 'drafts') {
            _emailLabel = EmailLabel.draft
          } else if (
            folderIdLower === 'junkemail' ||
            folderIdLower?.includes('junk') ||
            folderIdLower?.includes('spam')
          ) {
            // Treat Junk as Inbox for now, maybe add SPAM label later
          } else if (
            folderIdLower === 'deleteditems' ||
            folderIdLower?.includes('trash') ||
            folderIdLower?.includes('delete')
          ) {
            // Treat Trash as Inbox for now, maybe add TRASH label later
          }
          // Construct MessageData
          return {
            externalId: message.id,
            externalThreadId: message.conversationId || message.id, // Use conversationId, fallback to message id
            inboxId: this.inboxId,
            integrationId: this.integrationId,
            organizationId: this.organizationId,
            createdTime: createdTime,
            sentAt: sentAt,
            receivedAt: receivedAt,
            subject: message.subject || '',
            from: fromInput,
            to: toInputs,
            cc: ccInputs,
            bcc: bccInputs,
            replyTo: replyToInputs,
            hasAttachments: message.hasAttachments || false,
            attachments: [], // Processed separately if needed
            textHtml:
              message.body?.contentType?.toLowerCase() === 'html'
                ? message.body?.content
                : undefined,
            textPlain:
              message.body?.contentType?.toLowerCase() === 'text'
                ? message.body?.content
                : undefined,
            snippet: message.bodyPreview || '',
            isInbound: isInbound,
            isAutoReply: message.inferenceClassification?.toLowerCase() === 'other', // Basic check
            metadata: {
              conversationId: message.conversationId,
              parentFolderId: message.parentFolderId,
              isRead: message.isRead,
              inferenceClassification: message.inferenceClassification,
              // internetMessageHeaders: message.internetMessageHeaders, // Avoid storing large headers unless needed
            },
            keywords: message.categories || [], // Use categories as keywords
            labelIds: [], // Outlook uses folder IDs, not labels like Gmail
            internetMessageId: message.internetMessageId,
            folderId: message.parentFolderId,
          }
        } catch (error) {
          logger.error('Error converting Outlook message to MessageData:', {
            error,
            messageId: message.id,
            integrationId: this.integrationId,
          })
          return null
        }
      })
      .filter((m): m is MessageData => m !== null) // Filter out nulls and type guard
  }
  /** Returns the provider name */
  getProviderName(): string {
    return 'outlook'
  }
  // --- Helper to find well-known folder IDs ---
  private async findFolderId(folderWellKnownName: string): Promise<string | undefined> {
    // Graph API allows accessing well-known folders by name
    // e.g., /me/mailFolders/inbox, /me/mailFolders/archive, etc.
    // For simplicity, we'll just return the well-known name. The API call using it should resolve it.
    // A more robust solution could fetch and cache these IDs.
    return folderWellKnownName // Use 'inbox', 'archive', 'junkemail', 'deleteditems' directly in API calls
  }
  // --- Other Provider Methods (archive, markAsSpam, trash, restore, labels, etc.) ---
  // These need to be implemented using Graph API calls, typically involving moving messages
  // between folders or updating message properties (isRead, flag).
  async archive(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Archiving ${type}: ${externalId}`)
    // Moving to the 'archive' folder
    const archiveFolderId = await this.findFolderId('archive') // Use well-known name
    const endpoint = `/me/${type === 'message' ? 'messages' : 'mailFolders/TODO-ThreadMove'}/${externalId}/move`
    if (type === 'thread') {
      logger.warn('Archiving entire threads via folder move is complex and not fully implemented.')
      return false // Requires moving all messages in the conversation
    }
    try {
      await this.client!.api(endpoint).post({ destinationId: archiveFolderId })
      logger.info(`Successfully archived ${type} ${externalId}.`)
      return true
    } catch (error: any) {
      logger.error(`Failed to archive ${type} ${externalId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  async markAsSpam(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Marking ${type} as spam: ${externalId}`)
    // Moving to the 'junkemail' folder
    const junkFolderId = await this.findFolderId('junkemail')
    const endpoint = `/me/${type === 'message' ? 'messages' : 'mailFolders/TODO-ThreadMove'}/${externalId}/move`
    if (type === 'thread') {
      logger.warn(
        'Marking entire threads as spam via folder move is complex and not fully implemented.'
      )
      return false
    }
    try {
      await this.client!.api(endpoint).post({ destinationId: junkFolderId })
      logger.info(`Successfully marked ${type} ${externalId} as spam (moved to Junk).`)
      return true
    } catch (error: any) {
      logger.error(`Failed to mark ${type} ${externalId} as spam`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  async trash(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Trashing ${type}: ${externalId}`)
    // Moving to the 'deleteditems' folder
    const deletedFolderId = await this.findFolderId('deleteditems')
    const endpoint = `/me/${type === 'message' ? 'messages' : 'mailFolders/TODO-ThreadMove'}/${externalId}/move`
    if (type === 'thread') {
      logger.warn('Trashing entire threads via folder move is complex and not fully implemented.')
      return false
    }
    try {
      await this.client!.api(endpoint).post({ destinationId: deletedFolderId })
      logger.info(`Successfully trashed ${type} ${externalId} (moved to Deleted Items).`)
      return true
    } catch (error: any) {
      logger.error(`Failed to trash ${type} ${externalId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  async restore(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Restoring ${type}: ${externalId}`)
    // Moving back to the 'inbox' folder
    const inboxFolderId = await this.findFolderId('inbox')
    const endpoint = `/me/${type === 'message' ? 'messages' : 'mailFolders/TODO-ThreadMove'}/${externalId}/move`
    if (type === 'thread') {
      logger.warn('Restoring entire threads via folder move is complex and not fully implemented.')
      return false
    }
    try {
      await this.client!.api(endpoint).post({ destinationId: inboxFolderId })
      logger.info(`Successfully restored ${type} ${externalId} (moved to Inbox).`)
      // Optionally mark as unread?
      await this.client!.api(`/me/messages/${externalId}`).patch({ isRead: false })
      return true
    } catch (error: any) {
      logger.error(`Failed to restore ${type} ${externalId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  // Draft methods
  async createDraft(options: SendMessageOptions): Promise<{
    id: string
    success: boolean
  }> {
    await this.ensureInitialized()
    logger.info('Creating Outlook draft...')
    try {
      const toRecipients = (Array.isArray(options.to) ? options.to : [options.to]).map((email) => ({
        emailAddress: { address: email },
      }))
      // Add CC/BCC etc. from metadata if needed
      const draftMessage = {
        subject: options.subject || '',
        body: {
          contentType: options.html ? 'HTML' : 'Text',
          content: options.html || options.text || '',
        },
        toRecipients: toRecipients,
        // ccRecipients: ..., bccRecipients: ...
      }
      // POSTing to /me/messages creates a draft in the Drafts folder
      const response = await this.client!.api('/me/messages').post(draftMessage)
      if (!response.id) throw new Error('Draft creation failed to return ID.')
      logger.info(`Outlook draft created successfully: ${response.id}`)
      return { id: response.id, success: true }
    } catch (error: any) {
      logger.error('Failed to create Outlook draft', {
        error: error.message,
        statusCode: error.statusCode,
      })
      return { id: '', success: false }
    }
  }
  async updateDraft(draftId: string, options: Partial<SendMessageOptions>): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Updating Outlook draft: ${draftId}`)
    try {
      const updatePayload: any = {}
      if (options.to)
        updatePayload.toRecipients = (Array.isArray(options.to) ? options.to : [options.to]).map(
          (email) => ({ emailAddress: { address: email } })
        )
      // Add CC/BCC updates if options provided
      if (options.subject !== undefined) updatePayload.subject = options.subject
      if (options.html !== undefined || options.text !== undefined) {
        updatePayload.body = {
          contentType: options.html ? 'HTML' : 'Text',
          content: options.html || options.text || '',
        }
      }
      // TODO: Handle attachment updates if needed
      if (Object.keys(updatePayload).length === 0) {
        logger.warn('No fields provided to update draft.', { draftId })
        return true // Nothing to update
      }
      await this.client!.api(`/me/messages/${draftId}`).patch(updatePayload)
      logger.info(`Outlook draft ${draftId} updated successfully.`)
      return true
    } catch (error: any) {
      logger.error(`Failed to update Outlook draft ${draftId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  async sendDraft(draftId: string): Promise<{
    id: string
    success: boolean
  }> {
    await this.ensureInitialized()
    logger.info(`Sending Outlook draft: ${draftId}`)
    try {
      await this.client!.api(`/me/messages/${draftId}/send`).post({})
      // Send action deletes the draft item. No new message ID is returned by this action.
      logger.info(`Outlook draft ${draftId} sent successfully.`)
      return { id: draftId, success: true } // Return original draft ID as reference
    } catch (error: any) {
      logger.error(`Failed to send Outlook draft ${draftId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return { id: draftId, success: false }
    }
  }
  // Label/Folder methods map to Outlook MailFolders
  async getLabels(): Promise<any[]> {
    await this.ensureInitialized()
    logger.info('Getting Outlook mail folders (labels)')
    try {
      // Fetch top-level folders, expand children if needed with $expand=childFolders
      const response = await this.client!.api('/me/mailFolders')
        .select('id,displayName,parentFolderId,childFolderCount,isHidden')
        .get()
      return response.value || []
    } catch (error: any) {
      logger.error('Failed to get Outlook mail folders', {
        error: error.message,
        statusCode: error.statusCode,
      })
      return []
    }
  }
  async createLabel(options: { name: string; color?: string; visible?: boolean }): Promise<any> {
    await this.ensureInitialized()
    logger.info(`Creating Outlook mail folder (label): ${options.name}`)
    try {
      const payload = {
        displayName: options.name,
        // Visibility maps to isHidden (true = hidden)
        ...(options.visible !== undefined && { isHidden: !options.visible }),
        // Color is not supported directly for folders via standard Graph API
      }
      // Create folder under root (or specify parentFolderId if needed)
      const response = await this.client!.api('/me/mailFolders').post(payload)
      logger.info(`Outlook mail folder created: ${response.id}`)
      return response // Returns the created folder object
    } catch (error: any) {
      logger.error(`Failed to create Outlook mail folder ${options.name}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      throw error // Rethrow creation errors
    }
  }
  async updateLabel(
    labelId: string,
    options: {
      name?: string
      color?: string
      visible?: boolean
    }
  ): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Updating Outlook mail folder (label): ${labelId}`)
    try {
      const updatePayload: any = {}
      if (options.name !== undefined) updatePayload.displayName = options.name
      if (options.visible !== undefined) updatePayload.isHidden = !options.visible
      if (Object.keys(updatePayload).length === 0) return true // No update needed
      await this.client!.api(`/me/mailFolders/${labelId}`).patch(updatePayload)
      logger.info(`Outlook mail folder ${labelId} updated.`)
      return true
    } catch (error: any) {
      logger.error(`Failed to update Outlook mail folder ${labelId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  async deleteLabel(labelId: string): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Deleting Outlook mail folder (label): ${labelId}`)
    try {
      await this.client!.api(`/me/mailFolders/${labelId}`).delete()
      logger.info(`Outlook mail folder ${labelId} deleted.`)
      return true
    } catch (error: any) {
      // Check for errors indicating deletion of default folders (e.g., Inbox)
      logger.error(`Failed to delete Outlook mail folder ${labelId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  // Add/Remove Label maps to Moving items between folders
  async addLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    await this.ensureInitialized()
    logger.info(`Moving ${type} ${externalId} to folder (label) ${labelId}`)
    const endpoint = `/me/${type === 'message' ? 'messages' : 'mailFolders/TODO-ThreadMove'}/${externalId}/move`
    if (type === 'thread') {
      logger.warn('Moving entire threads via folder move is complex and not fully implemented.')
      return false
    }
    try {
      await this.client!.api(endpoint).post({ destinationId: labelId })
      logger.info(`Successfully moved ${type} ${externalId} to folder ${labelId}.`)
      return true
    } catch (error: any) {
      logger.error(`Failed to move ${type} ${externalId} to folder ${labelId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  async removeLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    // Removing a label doesn't directly map. Usually means moving back to Inbox.
    logger.warn(
      `'removeLabel' called for Outlook ${type} ${externalId} from folder ${labelId}. Moving to Inbox instead.`
    )
    const inboxFolderId = await this.findFolderId('inbox')
    return this.addLabel(inboxFolderId!, externalId, type) // Move to inbox
  }
  // Thread operations
  async getThread(externalThreadId: string): Promise<any> {
    // Graph API represents threads via conversationId. Fetch messages in that conversation.
    await this.ensureInitialized()
    logger.info(`Getting Outlook messages for thread (conversation): ${externalThreadId}`)
    try {
      const response = await this.client!.api('/me/messages')
        .filter(`conversationId eq '${externalThreadId}'`)
        .select('id,subject,from,toRecipients,receivedDateTime,bodyPreview,parentFolderId') // Select key fields
        .orderby('receivedDateTime desc')
        .top(50) // Limit results
        .get()
      // Return the list of messages - maybe aggregate info?
      return {
        id: externalThreadId,
        messages: response.value || [],
        // Add other aggregated info if needed
      }
    } catch (error: any) {
      logger.error(`Failed to get messages for conversation ${externalThreadId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      throw error
    }
  }
  async updateThreadStatus(externalThreadId: string, status: MessageStatus): Promise<boolean> {
    // This is complex: needs to fetch all messages in the thread and apply status update (e.g., isRead) to each.
    await this.ensureInitialized()
    logger.info(`Updating status for thread ${externalThreadId} to ${status}`)
    try {
      const threadInfo = await this.getThread(externalThreadId)
      if (!threadInfo?.messages || threadInfo.messages.length === 0) {
        logger.warn(`No messages found for thread ${externalThreadId} to update status.`)
        return false
      }
      const updatePayload: any = {}
      let actionTaken = false
      switch (status) {
        case MessageStatus.READ:
          updatePayload.isRead = true
          actionTaken = true
          break
        case MessageStatus.UNREAD:
          updatePayload.isRead = false
          actionTaken = true
          break
        // Flag/Importance updates might be possible too
        default:
          logger.warn(`Unsupported thread status update: ${status}`)
          return false
      }
      if (!actionTaken) return true // No change needed
      // Batch update messages
      const batchPayload = {
        requests: threadInfo.messages
          .slice(0, GRAPH_BATCH_LIMIT)
          .map((msg: any, index: number) => ({
            id: `${index + 1}`,
            method: 'PATCH',
            url: `/me/messages/${msg.id}`,
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'IdType="ImmutableId"',
            },
            body: updatePayload,
          })),
      }
      if (threadInfo.messages.length > GRAPH_BATCH_LIMIT) {
        logger.warn(
          `Batch size limit exceeded for thread status update (${threadInfo.messages.length}), limiting to ${GRAPH_BATCH_LIMIT}.`
        )
      }
      const batchResponse = await this.client!.api('/$batch').post(batchPayload)
      // Check batch response for errors
      let allSucceeded = true
      batchResponse.responses?.forEach((resp: any) => {
        if (resp.status < 200 || resp.status >= 300) {
          logger.error(`Failed batch request item for thread status update`, {
            reqId: resp.id,
            status: resp.status,
            body: resp.body,
          })
          allSucceeded = false
        }
      })
      return allSucceeded
    } catch (error: any) {
      logger.error(`Failed to update thread ${externalThreadId} status`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  async moveThread(externalThreadId: string, destinationLabelId: string): Promise<boolean> {
    // Complex: Fetch all messages in thread and move each one. Use batching.
    await this.ensureInitialized()
    logger.info(`Moving thread ${externalThreadId} to folder ${destinationLabelId}`)
    try {
      const threadInfo = await this.getThread(externalThreadId)
      if (!threadInfo?.messages || threadInfo.messages.length === 0) {
        logger.warn(`No messages found for thread ${externalThreadId} to move.`)
        return false
      }
      const batchPayload = {
        requests: threadInfo.messages
          .slice(0, GRAPH_BATCH_LIMIT)
          .map((msg: any, index: number) => ({
            id: `${index + 1}`,
            method: 'POST',
            url: `/me/messages/${msg.id}/move`,
            headers: {
              'Content-Type': 'application/json',
              Prefer: 'IdType="ImmutableId"',
            },
            body: { destinationId: destinationLabelId },
          })),
      }
      if (threadInfo.messages.length > GRAPH_BATCH_LIMIT) {
        logger.warn(
          `Batch size limit exceeded for thread move (${threadInfo.messages.length}), limiting to ${GRAPH_BATCH_LIMIT}.`
        )
      }
      const batchResponse = await this.client!.api('/$batch').post(batchPayload)
      let allSucceeded = true
      batchResponse.responses?.forEach((resp: any) => {
        if (resp.status < 200 || resp.status >= 300) {
          logger.error(`Failed batch request item for thread move`, {
            reqId: resp.id,
            status: resp.status,
            body: resp.body,
          })
          allSucceeded = false
        }
      })
      if (allSucceeded)
        logger.info(`Successfully moved (batched) messages for thread ${externalThreadId}.`)
      return allSucceeded
    } catch (error: any) {
      logger.error(`Failed to move thread ${externalThreadId}`, {
        error: error.message,
        statusCode: error.statusCode,
      })
      return false
    }
  }
  // --- Two-Phase Polling Sync ---

  supportsTwoPhaseSync(): boolean {
    return true
  }

  async discoverLabels(): Promise<
    { externalId: string; name: string; isSentBox: boolean; parentExternalId: string | null }[]
  > {
    await this.ensureInitialized()

    try {
      const response = await this.client!.api('/me/mailFolders')
        .select('id,displayName,parentFolderId,childFolderCount,isHidden')
        .top(OUTLOOK_MAX_PAGE_SIZE)
        .get()

      const folders = response.value || []

      return folders
        .filter((folder: any) => !folder.isHidden)
        .map((folder: any) => ({
          externalId: folder.id,
          name: folder.displayName,
          isSentBox: folder.displayName === 'Sent Items',
          parentExternalId: folder.parentFolderId || null,
        }))
    } catch (error: any) {
      logger.error('Failed to discover Outlook folders', {
        error: error.message,
        integrationId: this.integrationId,
      })
      return []
    }
  }

  /** Discovers email aliases (proxyAddresses) for the authenticated user */
  async discoverEmailAliases(): Promise<string[]> {
    await this.ensureInitialized()

    try {
      const response = await this.client!.api('/me?$select=proxyAddresses').get()
      const proxyAddresses: string[] = response.proxyAddresses ?? []

      // Filter to secondary aliases (lowercase smtp:), skip primary (uppercase SMTP:)
      return proxyAddresses
        .filter((addr: string) => addr.startsWith('smtp:'))
        .map((addr: string) => addr.replace('smtp:', '').toLowerCase())
        .filter(Boolean)
    } catch (error: any) {
      logger.warn('Failed to discover email aliases', {
        integrationId: this.integrationId,
        error: error.message,
      })
      return []
    }
  }

  async fetchMessageIds(since?: Date): Promise<MessageListResult[]> {
    await this.ensureInitialized()

    // Query synced labels from DB to get per-folder cursors
    const labels = await db
      .select()
      .from(schema.Label)
      .where(
        and(eq(schema.Label.integrationId, this.integrationId!), eq(schema.Label.enabled, true))
      )

    if (labels.length === 0) {
      logger.info('No labels found for Outlook integration, skipping fetchMessageIds', {
        integrationId: this.integrationId,
      })
      return []
    }

    const results: MessageListResult[] = []
    const selectFields = 'id'

    // Process folders with concurrency limit
    const CONCURRENCY = 4
    for (let i = 0; i < labels.length; i += CONCURRENCY) {
      const batch = labels.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map(async (label) => {
          try {
            const messageIds: string[] = []
            const deletedMessageIds: string[] = []

            let url: string
            if (label.providerCursor && !since) {
              url = label.providerCursor
            } else {
              const dateFilter = since ? `&$filter=receivedDateTime ge ${since.toISOString()}` : ''
              url = `/me/mailFolders/${label.labelId}/messages/delta?$select=${selectFields}${dateFilter}`
            }

            let response: PageCollection
            try {
              response = await this.client!.api(url)
                .version('beta')
                .headers({ Prefer: IMMUTABLE_ID_PREFER })
                .get()
            } catch (error) {
              const parsed = parseGraphApiError(error)
              if (parsed.code === 'SYNC_CURSOR_ERROR') {
                logger.warn(`Delta link expired for label ${label.name}, resetting cursor`, {
                  labelId: label.id,
                  integrationId: this.integrationId,
                })
                const dateFilter = since
                  ? `&$filter=receivedDateTime ge ${since.toISOString()}`
                  : ''
                url = `/me/mailFolders/${label.labelId}/messages/delta?$select=${selectFields}${dateFilter}`
                response = await this.client!.api(url)
                  .version('beta')
                  .headers({ Prefer: IMMUTABLE_ID_PREFER })
                  .get()
              } else {
                throw error
              }
            }

            const callback: PageIteratorCallback = (data) => {
              if (data['@removed']) {
                if (data.id) deletedMessageIds.push(data.id)
              } else if (data.id) {
                messageIds.push(data.id)
              }
              return true
            }

            const pageIterator = new PageIterator(this.client!, response, callback, {
              headers: { Prefer: IMMUTABLE_ID_PREFER },
            })

            await pageIterator.iterate()
            const deltaLink = pageIterator.getDeltaLink()

            if (messageIds.length > 0 || deletedMessageIds.length > 0 || deltaLink) {
              results.push({
                messageIds,
                deletedMessageIds,
                previousCursor: label.providerCursor,
                nextCursor: deltaLink || label.providerCursor || '',
                labelId: label.id,
              })
            }
          } catch (error: any) {
            logger.error('Failed to fetch message IDs for Outlook folder', {
              labelId: label.id,
              labelName: label.name,
              integrationId: this.integrationId,
              error: error.message,
            })
          }
        })
      )

      // Log any rejected promises
      for (const result of batchResults) {
        if (result.status === 'rejected') {
          logger.error('Folder delta fetch rejected', { reason: result.reason })
        }
      }
    }

    const totalIds = results.reduce((sum, r) => sum + r.messageIds.length, 0)
    const totalDeleted = results.reduce((sum, r) => sum + r.deletedMessageIds.length, 0)

    logger.info('fetchMessageIds completed for Outlook', {
      integrationId: this.integrationId,
      foldersProcessed: results.length,
      totalMessageIds: totalIds,
      totalDeletedIds: totalDeleted,
    })

    return results
  }

  async importMessages(externalIds: string[]): Promise<{ imported: number; failed: number }> {
    await this.ensureInitialized()

    const allMessages: GraphMessage[] = []
    let failedCount = 0
    const messageSelectFields =
      'id,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,body,internetMessageId,parentFolderId,isRead,hasAttachments,categories,internetMessageHeaders,inferenceClassification'

    // Fetch messages in batches using Graph /$batch endpoint
    for (let i = 0; i < externalIds.length; i += GRAPH_BATCH_LIMIT) {
      const batchIds = externalIds.slice(i, i + GRAPH_BATCH_LIMIT)

      const batchRequests = batchIds.map((messageId, index) => ({
        id: (index + 1).toString(),
        method: 'GET',
        url: `/me/messages/${messageId}?$select=${messageSelectFields}`,
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'IdType="ImmutableId"',
        },
      }))

      const batchResponse = await this.client!.api('/$batch').post({ requests: batchRequests })

      for (const response of batchResponse.responses ?? []) {
        if (response.status === 200) {
          allMessages.push(response.body)
        } else {
          const parsed = parseGraphApiError({
            statusCode: response.status,
            message: response.body?.error?.message,
            code: response.body?.error?.code,
          })

          if (parsed.code === 'NOT_FOUND') {
            failedCount++
            continue
          }

          if (parsed.retryable) {
            throw parsed // Let the job retry
          }

          logger.error('Batch item failed during importMessages', {
            status: response.status,
            error: parsed.message,
          })
          failedCount++
        }
      }
    }

    if (allMessages.length === 0) {
      return { imported: 0, failed: failedCount }
    }

    const messageDataArray = this.convertMessagesToMessageData(allMessages)
    const ingestor = new OutlookInboundContentIngestor(this.organizationId, this.storageService)
    const result = await ingestor.storeBatchWithIngest(messageDataArray, {
      client: this.client!,
      integrationId: this.integrationId!,
    })

    logger.info('importMessages completed for Outlook', {
      integrationId: this.integrationId,
      requested: externalIds.length,
      fetched: allMessages.length,
      stored: result.storedCount,
      failed: failedCount + result.failedCount,
    })

    return {
      imported: result.storedCount,
      failed: failedCount + result.failedCount,
    }
  }

  // --- Simulation ---

  async simulateOperation(operation: string, targetId: string, params?: any): Promise<any> {
    logger.warn('simulateOperation is not implemented for OutlookProvider')
    return Promise.resolve({ success: false, message: 'Not implemented' })
  }
}
