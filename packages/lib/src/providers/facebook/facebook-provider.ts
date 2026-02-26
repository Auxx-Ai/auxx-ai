// src/lib/providers/facebook/facebook-provider.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import {
  type MessageData, // Data structure expected by storage service
  MessageStorageService,
  type ParticipantInputData, // Structure for participant info from provider
} from '../../email/email-storage' // Adjust path
import type {
  IntegrationProvider,
  MessageStatus,
  SendMessageOptions,
} from '../integration-provider.interface' // Adjust path based on final structure
import { IntegrationTokenAccessor } from '../integration-token-accessor'
import { BaseMessageProvider, type MessageProvider } from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'
import { type FacebookIntegrationMetadata, FacebookOAuthService } from './facebook-oauth'

const logger = createScopedLogger('facebook-provider')
const DEFAULT_API_VERSION = 'v19.0'

// --- Interface Definitions (for clarity, align with Graph API responses) ---
interface FacebookSendMessagePayload {
  recipient: {
    id: string
  } // PSID of the recipient
  messaging_type: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG' // Typically RESPONSE
  message: {
    text?: string
    attachment?: {
      // Simplified attachment structure
      type: 'image' | 'audio' | 'video' | 'file' | 'template'
      payload: {
        url?: string
        is_reusable?: boolean
      }
    }
  }
}
interface FacebookWebhookMessage {
  mid: string // Message ID
  text?: string
  attachments?: Array<{
    type: string
    payload: {
      url?: string
      title?: string
    }
  }>
}
// Structure of participant from conversation or message webhook
interface FacebookGraphParticipant {
  id: string // PSID or Page ID
  name?: string
}
// --- End Interfaces ---
export class FacebookProvider
  extends BaseMessageProvider
  implements IntegrationProvider, MessageProvider
{
  private inboxId: string | undefined = undefined
  private metadata: FacebookIntegrationMetadata | null = null
  private pageAccessToken: string | null = null
  private pageId: string | null = null
  private apiVersion: string
  private oauthService: FacebookOAuthService
  private storageService: MessageStorageService
  constructor(organizationId: string) {
    super(IntegrationProviderType.facebook, '', organizationId)
    try {
      this.apiVersion =
        configService.get<string>('FACEBOOK_GRAPH_API_VERSION') || DEFAULT_API_VERSION
    } catch {
      this.apiVersion = DEFAULT_API_VERSION
    }
    this.oauthService = FacebookOAuthService.getInstance()
    this.storageService = new MessageStorageService(organizationId)
  }
  /**
   * Get provider capabilities for Facebook Messenger
   */
  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.facebook)
  }
  /**
   * Initializes the provider for a specific integration instance.
   */
  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing FacebookProvider for integration: ${integrationId}`)
    ;(this as any).integrationId = integrationId
    const [integrationData] = await db
      .select({
        integration: schema.Integration,
        inboxIntegration: schema.InboxIntegration,
      })
      .from(schema.Integration)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Integration.id)
      )
      .where(
        and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        )
      )
      .limit(1)
    const integration = integrationData
      ? {
          ...integrationData.integration,
          inboxIntegration: integrationData.inboxIntegration,
        }
      : null
    this.inboxId = integration?.inboxIntegration?.inboxId
    // Validate the integration record retrieved from DB
    if (
      !integration ||
      integration.provider !== 'facebook' ||
      !integration.enabled ||
      !integration.metadata
    ) {
      this.resetState()
      throw new Error(
        `Active Facebook integration not found, not enabled, or missing metadata for ID: ${integrationId}`
      )
    }
    // Get tokens from encrypted credentials
    const tokens = await IntegrationTokenAccessor.getTokens(integrationId)
    // Safely cast and extract metadata
    try {
      this.metadata = integration.metadata as unknown as FacebookIntegrationMetadata
      this.pageAccessToken = tokens.accessToken // Decrypted LL Page Token
      this.pageId = this.metadata.pageId
      if (!this.pageId || !this.pageAccessToken) {
        throw new Error('Page ID or Page Access Token missing in metadata.')
      }
    } catch (e) {
      this.resetState()
      logger.error('Failed to parse metadata for Facebook integration', {
        integrationId,
        metadata: integration.metadata,
        error: e,
      })
      throw new Error(`Invalid metadata format for Facebook integration ${integrationId}`)
    }
    // Pass integration settings to storage service
    if (integration.settings) {
      this.storageService.setIntegrationSettings(integration.settings as any)
      logger.info(`Integration settings loaded for selective mode: ${integration.settings}`)
    }
    logger.info(`FacebookProvider initialized successfully for Page ID: ${this.pageId}`, {
      integrationId,
    })
  }
  /** Resets the internal state of the provider instance */
  private resetState(): void {
    this.integrationId = null
    this.inboxId = undefined
    this.metadata = null
    this.pageAccessToken = null
    this.pageId = null
  }
  /** Ensures the provider is initialized before use */
  private async ensureInitialized(): Promise<void> {
    if (!this.integrationId || !this.pageId || !this.pageAccessToken || !this.metadata) {
      if (this.integrationId) {
        logger.warn(
          `Re-initializing Facebook provider due to missing state for ${this.integrationId}`
        )
        await this.initialize(this.integrationId)
      } else {
        // This state should ideally be prevented by how the service manager uses providers
        throw new Error('FacebookProvider not initialized with an integration ID.')
      }
    }
    // Optional: Add token validity check here if needed
    // await this.oauthService.refreshTokens(this.integrationId); // Checks validity
  }
  /**
   * Sends a message via the Facebook Graph API (Messenger Platform).
   * options.to is expected to be the recipient's Page-Scoped ID (PSID).
   */
  async sendMessage(options: SendMessageOptions): Promise<{
    id?: string
    success: boolean
  }> {
    await this.ensureInitialized()
    const recipientPsid = Array.isArray(options.to) ? options.to[0] : options.to
    if (!recipientPsid || typeof recipientPsid !== 'string') {
      throw new Error(
        "Recipient PSID (Page-Scoped ID) is required in 'to' field for Facebook messages."
      )
    }
    if (!options.text) {
      throw new Error('Facebook message must contain text (attachments not implemented).')
    }
    // Construct the payload for the Graph API
    const payload: FacebookSendMessagePayload = {
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE', // Assume response within 24h window
      message: {
        text: options.text,
        // TODO: Handle options.attachments if needed (complex)
      },
      // TODO: Handle messaging_type variations (e.g., MESSAGE_TAG) via options.metadata
    }
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/me/messages?access_token=${this.pageAccessToken}`
    try {
      logger.debug(`Sending Facebook message from Page ${this.pageId} to PSID ${recipientPsid}`)
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'AuxxFacebookProvider/1.0' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        logger.error('Failed to send Facebook message via Graph API', {
          status: response.status,
          error: data.error,
          pageId: this.pageId,
          recipient: recipientPsid,
          integrationId: this.integrationId,
        })
        throw new Error(
          `Facebook API error: ${data.error?.message || 'Unknown send error'} (Code: ${data.error?.code})`
        )
      }
      logger.info('Facebook message sent successfully', {
        recipientPsid,
        messageId: data.message_id,
        integrationId: this.integrationId,
      })
      // Return the message ID provided by Facebook
      return { id: data.message_id, success: true }
    } catch (error: any) {
      logger.error('Network/fetch error sending message via Facebook API:', {
        error: error.message,
        integrationId: this.integrationId,
      })
      // Re-throw the error for the caller to handle
      throw error
    }
  }
  /** Confirms webhook setup (managed externally via FB App Dashboard) */
  async setupWebhook(callbackUrl: string): Promise<void> {
    await this.ensureInitialized()
    // Actual subscription is done via OAuthService.subscribePageToApp and FB App Dashboard.
    // This method serves as a placeholder or potential verification step.
    logger.info(
      `Facebook webhook setup confirmation check for Page ID: ${this.pageId}. Ensure webhooks are configured in the Facebook App Dashboard pointing to the correct callback URL.`,
      { integrationId: this.integrationId, expectedCallback: callbackUrl }
    )
    return Promise.resolve()
  }
  /** Confirms webhook removal (managed externally via FB App Dashboard/Disconnect) */
  async removeWebhook(): Promise<void> {
    await this.ensureInitialized()
    // Actual unsubscription is done via OAuthService.unsubscribePageFromApp during disconnect.
    logger.info(
      `Facebook webhook removal confirmation check for Page ID: ${this.pageId}. Unsubscription is typically handled during integration disconnect.`,
      { integrationId: this.integrationId }
    )
    return Promise.resolve()
  }
  /**
   * Synchronizes messages from Facebook Messenger using the Conversation API.
   */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()
    logger.info('Starting Facebook message sync', {
      pageId: this.pageId,
      since: since?.toISOString(),
      integrationId: this.integrationId,
    })
    try {
      // Initial URL for conversations endpoint
      let conversationsLink: string | null =
        `https://graph.facebook.com/${this.apiVersion}/${this.pageId}/conversations?platform=messenger&fields=id,participants{id,name},updated_time,snippet&access_token=${this.pageAccessToken}`
      let totalMessagesProcessed = 0
      const processedConversationIds = new Set<string>() // Track processed convos to avoid duplicate message fetching if API behaves unexpectedly
      // --- Paginate through Conversations ---
      while (conversationsLink) {
        logger.debug(
          `Fetching conversations page: ${conversationsLink.split('access_token=')[0]}...`,
          { integrationId: this.integrationId }
        )
        const convoRes = await fetch(conversationsLink)
        const convoData = await convoRes.json()
        if (!convoRes.ok || convoData.error) {
          logger.error('Failed to fetch conversations', {
            status: convoRes.status,
            error: convoData.error,
            pageId: this.pageId,
          })
          throw new Error(`Failed to fetch conversations: ${convoData.error?.message}`)
        }
        const conversations = convoData.data || []
        logger.info(`Fetched ${conversations.length} conversations on this page.`, {
          integrationId: this.integrationId,
        })
        if (conversations.length === 0) break // Exit if no more conversations
        // --- Process Messages within each Conversation ---
        for (const conversation of conversations) {
          const conversationId = conversation.id // This is the FB Conversation ID (our externalThreadId)
          if (!conversationId || processedConversationIds.has(conversationId)) {
            continue // Skip if no ID or already processed
          }
          processedConversationIds.add(conversationId)
          // Check conversation update time against 'since' if provided
          if (since && conversation.updated_time) {
            const updatedTime = new Date(conversation.updated_time)
            if (updatedTime < since) {
              logger.debug(
                `Skipping conversation ${conversationId} updated at ${updatedTime.toISOString()} (before 'since' date ${since.toISOString()})`
              )
              continue
            }
          }
          // Extract user participant info from the conversation context
          let userContext: {
            psid: string
            name?: string
          } | null = null
          if (conversation.participants?.data) {
            const userParticipant = conversation.participants.data.find(
              (p: FacebookGraphParticipant) => p.id !== this.pageId
            )
            if (userParticipant) {
              userContext = { psid: userParticipant.id, name: userParticipant.name }
            }
          }
          if (!userContext) {
            logger.warn(
              `Could not determine user PSID for conversation ${conversationId}, skipping message fetching for this conversation.`
            )
            continue
          }
          // --- Paginate through Messages for this Conversation ---
          let messagesLink: string | null =
            `https://graph.facebook.com/${this.apiVersion}/${conversationId}/messages?access_token=${this.pageAccessToken}&fields=id,created_time,from{id,name},to{id,name},message{text,attachments,mid}` // Added mid
          const messagesToStore: MessageData[] = []
          // Apply 'since' filter to message fetching as well (more granular)
          if (since) {
            messagesLink += `&since=${Math.floor(since.getTime() / 1000)}`
          }
          while (messagesLink) {
            logger.debug(
              `Fetching messages page for FB conversation ${conversationId}: ${messagesLink.split('access_token=')[0]}...`,
              { integrationId: this.integrationId }
            )
            const msgRes = await fetch(messagesLink)
            const msgData = await msgRes.json()
            if (!msgRes.ok || msgData.error) {
              logger.error(`Failed to fetch messages for conversation ${conversationId}`, {
                status: msgRes.status,
                error: msgData.error,
              })
              messagesLink = null // Stop fetching for this conversation on error
              break // Break message loop
            }
            const messages = msgData.data || []
            if (messages.length === 0) break // Exit message loop if no messages on page
            logger.debug(
              `Fetched ${messages.length} messages for FB conversation ${conversationId} on this page.`,
              { integrationId: this.integrationId }
            )
            for (const message of messages) {
              // Pass the user context extracted from the conversation
              const converted = this.convertFacebookMessageToMessageData(
                message,
                conversationId,
                userContext
              )
              if (converted) {
                messagesToStore.push(converted)
              }
            }
            messagesLink = msgData.paging?.next // Get next page link for messages
          } // End message pagination loop
          // --- Store fetched messages for this conversation ---
          if (messagesToStore.length > 0) {
            // Batch store messages accepts MessageData[]
            const storedCount = await this.storageService.batchStoreMessages(messagesToStore)
            totalMessagesProcessed += storedCount
            logger.info(
              `Stored ${storedCount}/${messagesToStore.length} messages for FB conversation ${conversationId}.`,
              { integrationId: this.integrationId }
            )
          }
        } // End conversation loop
        conversationsLink = convoData.paging?.next // Get next page link for conversations
      } // End conversation pagination loop
      // Update last synced time after successful completion
      await db
        .update(schema.Integration)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.Integration.id, this.integrationId!))
      logger.info(
        `Facebook sync completed. Processed approximately ${totalMessagesProcessed} messages.`,
        { integrationId: this.integrationId }
      )
    } catch (error: any) {
      logger.error('Error during Facebook message sync:', {
        error: error.message,
        integrationId: this.integrationId,
      })
      // Update last synced time even on failure to mark the attempt? Optional.
      await db.integration
        .update({ where: { id: this.integrationId! }, data: { lastSyncedAt: new Date() } })
        .catch((updateErr) =>
          logger.error('Failed to update lastSyncedAt after sync error', { updateErr })
        )
      throw error // Re-throw the error
    }
  }
  /**
   * Converts a Facebook message object (from Graph API) to our standard MessageData format,
   * using ParticipantInputData structure.
   */
  private convertFacebookMessageToMessageData(
    message: any, // Raw message object from Graph API /{conv-id}/messages edge
    conversationId: string, // FB Conversation ID
    userContext: {
      psid: string
      name?: string
    } // User PSID and optional name from conversation context
  ): MessageData | null {
    // Ensure provider is initialized
    if (!this.integrationId || !this.pageId || !this.metadata) {
      logger.error('Provider state invalid during message conversion.')
      return null
    }
    try {
      // Extract core message details
      const fbMessageContent: FacebookWebhookMessage = message.message || {}
      // Use the nested message ID (mid) if available, otherwise fall back to the top-level message ID (id)
      const externalId = fbMessageContent.mid || message.id
      const createdTime = new Date(message.created_time)
      // Determine sender: Use 'from' field provided by Graph API
      const sender: FacebookGraphParticipant | undefined = message.from
      if (!sender?.id) {
        logger.warn('Could not determine sender ID for Facebook message', { messageId: externalId })
        return null // Cannot process without sender
      }
      let fromInput: ParticipantInputData
      let toInput: ParticipantInputData
      let isInbound = false
      // Check if the sender is the user (PSID matches user context)
      if (sender.id === userContext.psid) {
        isInbound = true
        fromInput = { identifier: sender.id, name: sender.name ?? userContext.name } // User PSID (sender)
        toInput = { identifier: this.pageId, name: this.metadata.pageName } // Page ID (recipient)
      }
      // Check if the sender is the page itself
      else if (sender.id === this.pageId) {
        isInbound = false
        fromInput = { identifier: this.pageId, name: sender.name ?? this.metadata.pageName } // Page ID (sender)
        // The recipient must be the user in this case
        toInput = { identifier: userContext.psid, name: userContext.name } // User PSID (recipient)
      }
      // Check if the sender is the page's associated business account (should be same as pageId usually)
      else if (this.metadata.pageId && sender.id === this.metadata.pageId) {
        // Treat this also as outbound
        isInbound = false
        fromInput = { identifier: sender.id, name: sender.name ?? this.metadata.pageName } // Page ID (sender)
        toInput = { identifier: userContext.psid, name: userContext.name } // User PSID (recipient)
      } else {
        logger.error('Could not determine participant roles for Facebook message', {
          messageId: externalId,
          senderId: sender.id,
          userPsid: userContext.psid,
          pageId: this.pageId,
        })
        return null // Skip if roles are unclear
      }
      // const text = fbMessageContent.text
      // Process attachments
      const attachments = (fbMessageContent.attachments || []).map((att: any) => ({
        filename: att.payload?.title || att.type || 'attachment',
        mimeType: att.type, // Facebook's type, not standard MIME
        size: 0, // Size often not available
        inline: false,
        contentLocation: att.payload?.url, // URL if available
      }))
      // Construct the MessageData object for storage
      const messageData: MessageData = {
        externalId: externalId,
        externalThreadId: conversationId, // Use FB Conversation ID
        integrationId: this.integrationId,
        inboxId: this.inboxId,
        organizationId: this.organizationId,
        createdTime: createdTime,
        sentAt: createdTime, // Use created_time as best estimate for send/receive
        receivedAt: createdTime,
        subject: `${sender.name} commented on your Facebook post`, // No subject in Messenger
        from: fromInput, // Use ParticipantInputData
        to: [toInput], // Use ParticipantInputData (always single recipient conceptually)
        cc: [],
        bcc: [],
        replyTo: [],
        hasAttachments: attachments.length > 0,
        attachments: attachments,
        textPlain: message.message, //text,
        textHtml: undefined, // No HTML support
        snippet: message.message
          ? message.message.substring(0, 100)
          : attachments[0]?.filename || '', // Basic snippet
        isInbound: isInbound,
        metadata: {
          // Store raw event parts for debugging or future use
          fb_from: message.from,
          fb_to: message.to,
          fb_message: message.message,
          fb_created_time: message.created_time,
        },
        // Default values for non-applicable fields
        keywords: [],
        labelIds: [],
      }
      return messageData
    } catch (error: any) {
      logger.error('Error converting Facebook message object to MessageData', {
        error: error.message,
        messageId: message?.id, // Log the raw message ID if available
        integrationId: this.integrationId,
      })
      return null // Return null if conversion fails
    }
  }
  /** Returns the provider name */
  getProviderName(): string {
    return 'facebook'
  }
  // --- Methods less applicable to Facebook (No-ops or Warnings) ---
  async archive(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'archive' operation not directly supported by Facebook provider for ${type} ${externalId}.`
    )
    return false // Indicate operation not performed
  }
  async markAsSpam(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'markAsSpam' operation not directly supported by Facebook provider for ${type} ${externalId}.`
    )
    return false
  }
  async trash(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'trash' operation not directly supported by Facebook provider for ${type} ${externalId}.`
    )
    // Note: Page *can* delete messages it sent, but not user messages. Complex to implement here.
    return false
  }
  async restore(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'restore' operation not directly supported by Facebook provider for ${type} ${externalId}.`
    )
    return false
  }
  // Drafts are not applicable to the real-time nature of Messenger
  async createDraft(options: SendMessageOptions): Promise<{
    id: string
    success: boolean
  }> {
    logger.warn("'createDraft' not applicable to Facebook provider.")
    return { id: '', success: false }
  }
  async updateDraft(draftId: string, options: Partial<SendMessageOptions>): Promise<boolean> {
    logger.warn("'updateDraft' not applicable to Facebook provider.")
    return false
  }
  async sendDraft(draftId: string): Promise<{
    id: string
    success: boolean
  }> {
    logger.warn("'sendDraft' not applicable to Facebook provider.")
    return { id: '', success: false }
  }
  // Labels map to Facebook Conversation Labels
  async getLabels(): Promise<any[]> {
    logger.info("'getLabels' - Fetching Facebook Page Conversation Labels.")
    await this.ensureInitialized()
    // API: GET /me/custom_labels?fields=name,id,color (using Page Token)
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/me/custom_labels?fields=name,id,color&access_token=${this.pageAccessToken}`
    try {
      const response = await fetch(apiUrl)
      const data = await response.json()
      if (!response.ok || data.error) {
        logger.error('Failed to fetch Facebook Conversation Labels', { error: data.error })
        return []
      }
      return data.data || [] // Return the array of label objects {id, name, color}
    } catch (error) {
      logger.error('Error fetching Facebook Conversation Labels', { error })
      return []
    }
  }
  async createLabel(options: { name: string; color?: string }): Promise<any> {
    logger.info(`'createLabel' - Creating Facebook Page Conversation Label: ${options.name}`)
    await this.ensureInitialized()
    // API: POST /me/custom_labels?name={name} (color not directly supported via API)
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/me/custom_labels`
    const params = new URLSearchParams({ name: options.name, access_token: this.pageAccessToken! })
    try {
      const response = await fetch(apiUrl, { method: 'POST', body: params })
      const data = await response.json()
      if (!response.ok || data.error) {
        logger.error('Failed to create Facebook Conversation Label', { error: data.error })
        throw new Error(`Failed to create label: ${data.error?.message}`)
      }
      return data // Returns { id: "label_id" } on success
    } catch (error) {
      logger.error('Error creating Facebook Conversation Label', { error })
      throw error
    }
  }
  async updateLabel(
    labelId: string,
    options: {
      name?: string
    }
  ): Promise<boolean> {
    // FB API doesn't support updating label name/color easily. Deletion/creation is typical.
    logger.warn(`'updateLabel' not supported for Facebook label ID ${labelId}. Recreate if needed.`)
    return false
  }
  async deleteLabel(labelId: string): Promise<boolean> {
    logger.info(`'deleteLabel' - Deleting Facebook Page Conversation Label ID: ${labelId}`)
    await this.ensureInitialized()
    // API: DELETE /{page-label-id}?access_token={page_access_token}
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${labelId}?access_token=${this.pageAccessToken}`
    try {
      const response = await fetch(apiUrl, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok || !data.success) {
        // Check for 'success: true'
        logger.error('Failed to delete Facebook Conversation Label', { labelId, error: data.error })
        return false
      }
      return true
    } catch (error) {
      logger.error('Error deleting Facebook Conversation Label', { labelId, error })
      return false
    }
  }
  // Add/Remove labels apply to CONVERSATIONS (threads) not messages
  async addLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    if (type === 'message') {
      logger.warn(
        `Adding labels directly to Facebook messages (ID: ${externalId}) is not supported.`
      )
      return false
    }
    // Adds a label to a conversation (externalId = conversation ID)
    logger.info(`Attempting to add label ${labelId} to conversation ${externalId}`)
    await this.ensureInitialized()
    // API: POST /{conversation-id}/custom_labels?label_id={label-id}
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${externalId}/custom_labels`
    const params = new URLSearchParams({ label_id: labelId, access_token: this.pageAccessToken! })
    try {
      const response = await fetch(apiUrl, { method: 'POST', body: params })
      const data = await response.json()
      if (!response.ok || !data.success) {
        logger.error(`Failed to add label ${labelId} to conversation ${externalId}`, {
          error: data.error,
        })
        return false
      }
      return true
    } catch (error) {
      logger.error(`Error adding label ${labelId} to conversation ${externalId}`, { error })
      return false
    }
  }
  async removeLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    if (type === 'message') {
      logger.warn(
        `Removing labels directly from Facebook messages (ID: ${externalId}) is not supported.`
      )
      return false
    }
    // Removes a label from a conversation (externalId = conversation ID)
    logger.info(`Attempting to remove label ${labelId} from conversation ${externalId}`)
    await this.ensureInitialized()
    // API: DELETE /{conversation-id}/custom_labels?label_id={label-id}
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${externalId}/custom_labels`
    const params = new URLSearchParams({ label_id: labelId, access_token: this.pageAccessToken! })
    try {
      const response = await fetch(`${apiUrl}?${params.toString()}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok || !data.success) {
        logger.error(`Failed to remove label ${labelId} from conversation ${externalId}`, {
          error: data.error,
        })
        return false
      }
      return true
    } catch (error) {
      logger.error(`Error removing label ${labelId} from conversation ${externalId}`, { error })
      return false
    }
  }
  // Get Thread (Conversation) Metadata
  async getThread(externalThreadId: string): Promise<any> {
    logger.info(`Getting Facebook conversation info for: ${externalThreadId}`)
    await this.ensureInitialized()
    // API: GET /{conversation-id}?fields=participants,updated_time,snippet,message_count,unread_count,link
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${externalThreadId}?fields=id,participants{id,name},updated_time,snippet,message_count,unread_count,link&access_token=${this.pageAccessToken}`
    try {
      const response = await fetch(apiUrl)
      const data = await response.json()
      if (!response.ok || data.error) {
        logger.error(`Failed to get conversation info for ${externalThreadId}`, {
          error: data.error,
        })
        throw new Error(`Failed to get conversation: ${data.error?.message}`)
      }
      return data // Return conversation metadata
    } catch (error) {
      logger.error(`Error getting conversation info for ${externalThreadId}`, { error })
      throw error
    }
  }
  // Status updates (read/unread) might be possible via /{conv-id}/messages edge or other APIs, complex.
  async updateThreadStatus(externalThreadId: string, status: MessageStatus): Promise<boolean> {
    logger.warn(
      `'updateThreadStatus' (${status}) mapping to Facebook actions is limited for conversation ${externalThreadId}.`
    )
    // Potentially mark as read? POST /{conversation-id}?read=true ? Check API docs.
    return false
  }
  // Moving a thread maps to adding/removing labels in Facebook
  async moveThread(externalThreadId: string, destinationLabelId: string): Promise<boolean> {
    logger.info(
      `'moveThread' requested for conversation ${externalThreadId} to label ${destinationLabelId}. Attempting addLabel.`
    )
    // This maps to adding the destination label to the conversation
    return this.addLabel(destinationLabelId, externalThreadId, 'thread')
  }
  // Simulation not applicable
  async simulateOperation(operation: string, targetId: string, params?: any): Promise<any> {
    logger.warn('simulateOperation is not implemented for FacebookProvider')
    return Promise.resolve({ success: false, message: 'Not implemented' })
  }
}
