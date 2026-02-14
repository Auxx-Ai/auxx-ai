// packages/lib/src/providers/openphone/openphone-provider.ts

import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import {
  EmailLabel, // Keep for MessageData structure
  IntegrationType,
  type MessageData,
  MessageStorageService,
  MessageType,
} from '../../email/email-storage' // Adjust path
import type {
  IntegrationProvider,
  MessageStatus, // Note: Most statuses don't map directly to OpenPhone
  SendMessageOptions,
} from '../integration-provider.interface' // Adjust path
import { BaseMessageProvider, type MessageProvider } from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'
import type {
  OpenPhoneAttachment,
  OpenPhoneConversation,
  OpenPhoneIntegrationMetadata,
  OpenPhoneMessage,
  OpenPhoneSendMessagePayload,
  OpenPhoneWebhookPayload,
  OpenPhoneWebhookResponse,
} from './types' // Import types

const logger = createScopedLogger('openphone-provider')
const OPENPHONE_API_BASE = 'https://api.openphone.co/v3' // Use v3
export class OpenPhoneProvider
  extends BaseMessageProvider
  implements IntegrationProvider, MessageProvider
{
  private metadata: OpenPhoneIntegrationMetadata | null = null
  private apiKey: string | null = null // The actual API key
  private phoneNumberId: string | null = null
  private phoneNumber: string | null = null // E.164 format
  private storageService: MessageStorageService
  constructor(organizationId: string) {
    super(IntegrationProviderType.openphone, '', organizationId)
    this.storageService = new MessageStorageService(organizationId)
  }
  /**
   * Get provider capabilities for OpenPhone
   */
  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.openphone)
  }
  /**
   * Initializes the provider with data from the integration record.
   */
  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing OpenPhoneProvider for integration: ${integrationId}`)
    ;(this as any).integrationId = integrationId
    const [integration] = await db
      .select()
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        )
      )
      .limit(1)
    if (
      !integration ||
      integration.provider !== 'openphone' ||
      !integration.enabled ||
      !integration.metadata ||
      !integration.accessToken
    ) {
      this.resetState()
      throw new Error(
        `Active OpenPhone integration not found, not enabled, or missing metadata/API key (stored in accessToken) for ID: ${integrationId}`
      )
    }
    // **Security Note:** Storing API keys directly in the DB (even in accessToken)
    // is generally discouraged. Consider encrypting it or using a secret manager.
    // For this implementation, we assume the API key is stored in `integration.accessToken`.
    this.apiKey = integration.accessToken
    try {
      this.metadata = integration.metadata as unknown as OpenPhoneIntegrationMetadata
      this.phoneNumberId = this.metadata.phoneNumberId
      this.phoneNumber = this.metadata.phoneNumber
      if (!this.phoneNumberId || !this.phoneNumber || !this.metadata.webhookSigningSecret) {
        throw new Error(
          'Essential metadata (phoneNumberId, phoneNumber, webhookSigningSecret) missing.'
        )
      }
    } catch (e) {
      this.resetState()
      logger.error('Failed to parse metadata for OpenPhone integration', {
        integrationId,
        metadata: integration.metadata,
        error: e,
      })
      throw new Error(`Invalid metadata format for OpenPhone integration ${integrationId}`)
    }
    // Pass integration settings to storage service
    if (integration.settings) {
      this.storageService.setIntegrationSettings(integration.settings as any)
      logger.info(`Integration settings loaded for selective mode: ${integration.settings}`)
    }
    logger.info(
      `OpenphoneProvider initialized successfully for Number: ${this.phoneNumber} (ID: ${this.phoneNumberId})`,
      { integrationId }
    )
  }
  private resetState(): void {
    this.integrationId = null
    this.metadata = null
    this.apiKey = null
    this.phoneNumberId = null
    this.phoneNumber = null
  }
  private async ensureInitialized(): Promise<void> {
    if (
      !this.integrationId ||
      !this.apiKey ||
      !this.phoneNumberId ||
      !this.phoneNumber ||
      !this.metadata
    ) {
      if (this.integrationId) {
        logger.warn(`Re-initializing OpenPhone provider for ${this.integrationId}`)
        await this.initialize(this.integrationId)
      } else {
        throw new Error('OpenPhoneProvider not initialized with an integration ID.')
      }
    }
  }
  /** Makes an authenticated API call to OpenPhone */
  private async apiCall<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string, // e.g., /messages
    payload?: any
  ): Promise<T> {
    await this.ensureInitialized()
    const url = `${OPENPHONE_API_BASE}${endpoint}`
    const headers: HeadersInit = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'AuxxOpenPhoneProvider/1.0',
    }
    const options: RequestInit = {
      method: method,
      headers: headers,
      body: payload ? JSON.stringify(payload) : undefined,
    }
    logger.debug(`OpenPhone API Call: ${method} ${url}`, {
      payload: method !== 'GET' ? payload : undefined,
    })
    try {
      const response = await fetch(url, options)
      const responseBody = await response.json() // Assume JSON response
      if (!response.ok) {
        logger.error(`OpenPhone API Error (${response.status}): ${method} ${url}`, {
          status: response.status,
          errorBody: responseBody,
        })
        // Attempt to extract a meaningful error message
        const errorMessage =
          responseBody?.message || responseBody?.error || `HTTP error ${response.status}`
        throw new Error(`OpenPhone API Error: ${errorMessage}`)
      }
      logger.debug(`OpenPhone API Success: ${method} ${url}`, { status: response.status })
      return responseBody as T
    } catch (error: any) {
      logger.error(`OpenPhone API Fetch Error: ${method} ${url}`, { error: error.message })
      // Rethrow network or parsing errors
      throw new Error(`Failed to call OpenPhone API: ${error.message}`)
    }
  }
  /**
   * Sends an SMS message via OpenPhone.
   */
  async sendMessage(options: SendMessageOptions): Promise<{
    id?: string
    success: boolean
  }> {
    await this.ensureInitialized()
    // Validate 'to' is a single phone number string
    const recipientPhoneNumber = Array.isArray(options.to) ? options.to[0] : options.to
    if (!recipientPhoneNumber || typeof recipientPhoneNumber !== 'string') {
      throw new Error(
        "Recipient phone number (E.164 format) is required in 'to' field for OpenPhone messages."
      )
    }
    if (!options.text) {
      throw new Error('Message body (text) is required for OpenPhone SMS.')
    }
    const payload: OpenPhoneSendMessagePayload = {
      phone_number_id: this.phoneNumberId!,
      to: recipientPhoneNumber,
      body: options.text,
      // TODO: Handle attachments from options.attachmentIds if needed
    }
    try {
      const response = await this.apiCall<{
        id: string
      }>('POST', '/messages', payload)
      logger.info('OpenPhone SMS sent successfully', {
        messageId: response.id,
        to: recipientPhoneNumber,
      })
      return { id: response.id, success: true }
    } catch (error: any) {
      logger.error('Error sending OpenPhone SMS:', {
        error: error.message,
        to: recipientPhoneNumber,
        integrationId: this.integrationId,
      })
      // Don't rethrow sensitive API errors directly to user in tRPC? Maybe.
      // For now, rethrow to indicate failure clearly.
      throw error
    }
  }
  /**
   * Configures webhooks via API. Requires webhookSigningSecret in metadata.
   */
  async setupWebhook(callbackUrl: string): Promise<void> {
    await this.ensureInitialized()
    if (!this.metadata?.webhookSigningSecret) {
      throw new Error('Cannot setup webhook: Missing webhookSigningSecret in integration metadata.')
    }
    const payload: OpenPhoneWebhookPayload = {
      url: callbackUrl,
      secret: this.metadata.webhookSigningSecret,
      triggers: [
        'message.received',
        // Add other triggers as needed: 'call.ringing', 'call.finished', 'message.sent' etc.
      ],
    }
    try {
      // Check if a webhook already exists (optional, to avoid duplicates)
      // If webhookId is stored in metadata, maybe update instead of create?
      // For simplicity, let's assume we create or it errors if one exists with same URL.
      logger.info('Attempting to create/update OpenPhone webhook', {
        url: callbackUrl,
        triggers: payload.triggers,
      })
      const response = await this.apiCall<OpenPhoneWebhookResponse>('POST', '/webhooks', payload)
      logger.info('OpenPhone webhook created/updated successfully', {
        webhookId: response.id,
        status: response.status,
      })
      // Store the webhook ID in metadata if not already there or different
      if (this.metadata?.webhookId !== response.id) {
        const updatedMetadata = { ...this.metadata, webhookId: response.id }
        await db
          .update(schema.Integration)
          .set({ metadata: updatedMetadata as any })
          .where(eq(schema.Integration.id, this.integrationId!))
        this.metadata.webhookId = response.id // Update local cache
      }
    } catch (error: any) {
      // Handle potential error if webhook with same URL already exists? OpenPhone might just update it.
      logger.error('Error setting up OpenPhone webhook:', {
        error: error.message,
        url: callbackUrl,
        integrationId: this.integrationId,
      })
      throw error
    }
  }
  /**
   * Removes the configured webhook via API.
   */
  async removeWebhook(): Promise<void> {
    await this.ensureInitialized()
    const webhookId = this.metadata?.webhookId
    if (!webhookId) {
      logger.warn('No stored OpenPhone webhook ID found to remove.', {
        integrationId: this.integrationId,
      })
      // Try listing webhooks and finding by URL? Complex. Assume stored ID is needed.
      return // Nothing to remove if ID isn't known
    }
    try {
      logger.info(`Attempting to delete OpenPhone webhook: ${webhookId}`)
      await this.apiCall('DELETE', `/webhooks/${webhookId}`)
      logger.info('OpenPhone webhook deleted successfully.', { webhookId })
      // Clear stored webhook ID from metadata
      const updatedMetadata = { ...this.metadata, webhookId: undefined }
      delete updatedMetadata.webhookId // Explicitly remove the key
      await db
        .update(schema.Integration)
        .set({ metadata: updatedMetadata as any })
        .where(eq(schema.Integration.id, this.integrationId!))
      if (this.metadata) {
        this.metadata.webhookId = undefined
      } // Update local cache
    } catch (error: any) {
      // Handle 404 if webhook already deleted
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        logger.warn('OpenPhone webhook not found during deletion (might be already deleted).', {
          webhookId,
        })
        // Clear stored ID anyway
        const updatedMetadata = { ...this.metadata, webhookId: undefined }
        delete updatedMetadata.webhookId
        await db
          .update(schema.Integration)
          .set({ metadata: updatedMetadata as any })
          .where(eq(schema.Integration.id, this.integrationId!))
          .catch((dbErr) => logger.error('Failed to clear webhookId after 404', { dbErr }))
        if (this.metadata) {
          this.metadata.webhookId = undefined
        }
        return
      }
      logger.error('Error deleting OpenPhone webhook:', {
        error: error.message,
        webhookId,
        integrationId: this.integrationId,
      })
      // Don't necessarily throw during cleanup, but log the error
      // throw error;
    }
  }
  /**
   * Synchronizes messages (SMS) from OpenPhone.
   */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()
    logger.info('Starting OpenPhone message sync', {
      phoneNumber: this.phoneNumber,
      since: since?.toISOString(),
      integrationId: this.integrationId,
    })
    try {
      let pageToken: string | undefined
      let hasMore = true
      let totalMessagesProcessed = 0
      // OpenPhone Conversation API returns latest message. We might need full history per convo.
      // Let's start by syncing conversations and storing the latest message.
      // A separate job might be needed for historical backfill per conversation.
      while (hasMore) {
        const params = new URLSearchParams()
        params.append('limit', '100') // Max limit
        if (pageToken) {
          params.append('pageToken', pageToken)
        }
        // Note: Filtering conversations by date or phoneNumberId is not directly documented for /conversations list.
        // We might fetch all accessible by the API key and process relevant ones.
        const endpoint = `/conversations?${params.toString()}`
        logger.debug(`Fetching conversations page`, {
          endpoint: endpoint.split('?')[0],
          pageToken: pageToken,
        })
        const response = await this.apiCall<{
          data: OpenPhoneConversation[]
          nextPageToken?: string
        }>('GET', endpoint)
        const conversations = response.data || []
        logger.info(`Fetched ${conversations.length} conversations page.`, { pageToken: pageToken })
        const messagesToStore: MessageData[] = []
        for (const conversation of conversations) {
          // Filter conversations related to our integrated phone number ID
          if (conversation.phone_number_id !== this.phoneNumberId) {
            logger.debug(
              `Skipping conversation ${conversation.id} for different phone number ${conversation.phone_number_id}`
            )
            continue
          }
          // Process the latest message from the conversation list endpoint
          if (conversation.latest_message) {
            // Check if latest message is newer than 'since' date if provided
            const messageDate = new Date(conversation.latest_message.date_created)
            if (since && messageDate < since) {
              logger.debug(
                `Skipping conversation ${conversation.id} as latest message is older than 'since' date.`
              )
              continue // Skip if latest message is too old
            }
            const converted = this.convertOpenPhoneMessageToMessageData(
              conversation.latest_message,
              conversation // Pass full conversation for context if needed
            )
            if (converted) {
              messagesToStore.push(converted)
            }
          }
          // TODO: Optionally fetch full message history for conversation if needed:
          // GET /conversations/{conversation.id}/messages
        }
        if (messagesToStore.length > 0) {
          const storedCount = await this.storageService.batchStoreMessages(messagesToStore)
          totalMessagesProcessed += storedCount
          logger.info(
            `Stored ${storedCount}/${messagesToStore.length} latest messages from conversations batch.`,
            { integrationId: this.integrationId }
          )
        }
        pageToken = response.nextPageToken
        hasMore = !!pageToken
      } // End pagination loop
      await db
        .update(schema.Integration)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.Integration.id, this.integrationId!))
      logger.info(
        `OpenPhone sync completed. Processed latest messages from conversations. Total stored: ${totalMessagesProcessed}.`,
        { integrationId: this.integrationId }
      )
    } catch (error: any) {
      logger.error('Error syncing messages from OpenPhone:', {
        error: error.message,
        integrationId: this.integrationId,
      })
      await db
        .update(schema.Integration)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.Integration.id, this.integrationId!))
        .catch((updateErr) =>
          logger.error('Failed to update lastSyncedAt after sync error', { updateErr })
        )
      throw error
    }
  }
  /** Converts an OpenPhone message object to our standard MessageData format */
  private convertOpenPhoneMessageToMessageData(
    message: OpenPhoneMessage,
    conversation?: OpenPhoneConversation // Optional conversation context
  ): MessageData | null {
    if (!this.integrationId || !this.phoneNumberId || !this.phoneNumber || !this.metadata) {
      logger.error('Cannot convert message, provider state invalid.')
      return null
    }
    try {
      const externalId = message.id
      const externalThreadId = message.conversation_id
      const createdTime = new Date(message.date_created)
      const sentAt = message.date_sent ? new Date(message.date_sent) : createdTime // Fallback to created time
      const receivedAt = message.direction === 'inbound' ? createdTime : sentAt // Received = created for inbound
      const isInbound = message.direction === 'inbound'
      // Determine participants (phone numbers)
      let fromNumber = isInbound ? message.sender_phone_number : this.phoneNumber
      let toNumber = isInbound ? this.phoneNumber : message.recipient_phone_number
      // Handle cases where numbers might be missing (though unlikely for SMS)
      if (!fromNumber) {
        logger.warn(`Missing sender number for message ${externalId}`)
        fromNumber = 'unknown_sender'
      }
      if (!toNumber) {
        logger.warn(`Missing recipient number for message ${externalId}`)
        toNumber = 'unknown_recipient'
      }
      const fromParticipant = { address: fromNumber, identifierType: IdentifierType.PHONE } // No name info directly on message sender/recipient
      const toParticipant = { address: toNumber, identifierType: IdentifierType.PHONE }
      const attachments = (message.attachments || []).map((att: OpenPhoneAttachment) => ({
        id: att.id, // Store OpenPhone attachment ID
        filename: att.file_name,
        mimeType: att.content_type,
        size: att.size_bytes,
        inline: false, // Assume not inline for SMS/MMS attachments
        contentLocation: att.url,
      }))
      const messageData: MessageData = {
        externalId: externalId,
        externalThreadId: externalThreadId,
        integrationId: this.integrationId,
        organizationId: this.organizationId,
        createdTime: createdTime,
        sentAt: sentAt,
        receivedAt: receivedAt,
        subject: undefined, // No subject for SMS
        from: fromParticipant,
        to: [toParticipant],
        cc: [],
        bcc: [],
        replyTo: [],
        hasAttachments: attachments.length > 0,
        attachments: attachments,
        textPlain: message.body,
        snippet: message.body?.substring(0, 100),
        isInbound: isInbound,
        metadata: { openphone_message: message, openphone_conversation: conversation }, // Store raw event
        keywords: [],
        labelIds: [],
        emailLabel: EmailLabel.inbox,
        // Fields from Message model defaults
        isAutoReply: false, // Assume false
        isFirstInThread: false, // Cannot easily determine from single message
        isAIGenerated: false, // Assume false
        internetMessageId: undefined,
        inReplyTo: undefined,
        references: undefined,
        threadIndex: undefined,
        folderId: undefined,
        // internetHeaders: undefined,
      }
      return messageData
    } catch (error: any) {
      logger.error('Error converting OpenPhone message to MessageData', {
        error: error.message,
        messageId: message?.id,
        integrationId: this.integrationId,
      })
      return null
    }
  }
  getProviderName(): string {
    return 'openphone'
  }
  // --- Methods less applicable to OpenPhone ---
  async archive(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(`'archive' not supported by OpenPhone provider for ${type} ${externalId}.`)
    return false
  }
  async markAsSpam(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'markAsSpam' not supported by OpenPhone provider for ${type} ${externalId}. Consider blocking contact.`
    )
    return false
  }
  async trash(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(`'trash' not supported by OpenPhone provider for ${type} ${externalId}.`)
    return false
  }
  async restore(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(`'restore' not supported by OpenPhone provider for ${type} ${externalId}.`)
    return false
  }
  async createDraft(options: SendMessageOptions): Promise<{
    id: string
    success: boolean
  }> {
    logger.warn("'createDraft' not applicable to OpenPhone provider.")
    return { id: '', success: false }
  }
  async updateDraft(draftId: string, options: Partial<SendMessageOptions>): Promise<boolean> {
    logger.warn("'updateDraft' not applicable to OpenPhone provider.")
    return false
  }
  async sendDraft(draftId: string): Promise<{
    id: string
    success: boolean
  }> {
    logger.warn("'sendDraft' not applicable to OpenPhone provider.")
    return { id: '', success: false }
  }
  async getLabels(): Promise<any[]> {
    logger.warn("'getLabels' not applicable to OpenPhone provider.")
    return []
  }
  async createLabel(options: any): Promise<any> {
    logger.warn("'createLabel' not applicable to OpenPhone provider.")
    throw new Error('Not implemented')
  }
  async updateLabel(labelId: string, options: any): Promise<boolean> {
    logger.warn("'updateLabel' not applicable to OpenPhone provider.")
    return false
  }
  async deleteLabel(labelId: string): Promise<boolean> {
    logger.warn("'deleteLabel' not applicable to OpenPhone provider.")
    return false
  }
  async addLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    logger.warn(`'addLabel' not applicable to OpenPhone provider for ${type} ${externalId}.`)
    return false
  }
  async removeLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    logger.warn(`'removeLabel' not applicable to OpenPhone provider for ${type} ${externalId}.`)
    return false
  }
  async getThread(externalThreadId: string): Promise<any> {
    logger.info(`Getting OpenPhone conversation info for: ${externalThreadId}`)
    try {
      // GET /conversations/{conversationId}
      const conversation = await this.apiCall<OpenPhoneConversation>(
        'GET',
        `/conversations/${externalThreadId}`
      )
      return conversation
    } catch (error) {
      logger.error(`Error getting OpenPhone conversation info for ${externalThreadId}`, { error })
      throw error
    }
  }
  async updateThreadStatus(externalThreadId: string, status: MessageStatus): Promise<boolean> {
    logger.warn(
      `'updateThreadStatus' not supported for OpenPhone conversation ${externalThreadId}.`
    )
    return false
  }
  async moveThread(externalThreadId: string, destinationLabelId: string): Promise<boolean> {
    logger.warn(`'moveThread' not supported for OpenPhone conversation ${externalThreadId}.`)
    return false
  }
  async simulateOperation(operation: string, targetId: string, params?: any): Promise<any> {
    logger.warn('simulateOperation is not implemented for OpenphoneProvider')
    return Promise.resolve({ success: false, message: 'Not implemented' })
  }
}
