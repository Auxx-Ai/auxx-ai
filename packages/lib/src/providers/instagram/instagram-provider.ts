// src/lib/providers/instagram/instagram-provider.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import {
  type IntegrationSettings, // Per-integration record-creation/filter settings
  type MessageData, // Data structure expected by storage service
  MessageStorageService,
  type ParticipantInputData, // Structure for participant info from provider
} from '../../email/email-storage' // Adjust path
import type {
  ChannelProvider,
  MessageStatus,
  SendMessageOptions,
} from '../channel-provider.interface' // Adjust path based on final structure
import { getChannelTokens } from '../channel-token-accessor'
import { BaseMessageProvider, type MessageProvider } from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'
import { SOCIAL_SUBSCRIBED_FIELDS, subscribePageToApp, unsubscribePageFromApp } from '../social/api'
import { sendSocialMessage } from '../social/send'
import { socialThreadKey } from '../social/thread-key'
import { type InstagramIntegrationMetadata, InstagramOAuthService } from './instagram-oauth'

const logger = createScopedLogger('instagram-provider')
const DEFAULT_API_VERSION = 'v19.0'

// --- Interface Definitions (Align with Graph API) ---
// Structure of message content within webhook/API response
interface InstagramGraphMessageContent {
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
interface InstagramGraphParticipant {
  id: string // IGSID or IGBID
  username?: string // Instagram username
}
/** Generic shape of a paginated Graph API edge response. */
interface InstagramGraphListResponse<T> {
  data?: T[]
  paging?: {
    next?: string | null
  }
  error?: {
    message?: string
    code?: number
  }
}
/** Conversation node returned by the /{page-id}/conversations edge (platform=instagram). */
interface InstagramGraphConversation {
  id?: string
  updated_time?: string
  participants?: {
    data?: InstagramGraphParticipant[]
  }
}
/** Message node returned by the /{conversation-id}/messages edge. */
interface InstagramGraphMessage {
  id?: string
  created_time?: string
  from?: InstagramGraphParticipant
  to?: unknown
  message?: unknown
}
// --- End Interfaces ---
export class InstagramProvider
  extends BaseMessageProvider
  implements ChannelProvider, MessageProvider
{
  private inboxId: string | undefined = undefined // Store inbox ID
  private metadata: InstagramIntegrationMetadata | null = null
  private pageAccessToken: string | null = null // LL Page Token (used for API calls)
  private pageId: string | null = null // Linked FB Page ID
  private instagramBusinessAccountId: string | null = null // IGBID
  private apiVersion: string
  private oauthService: InstagramOAuthService
  private storageService: MessageStorageService
  constructor(organizationId: string) {
    super(IntegrationProviderType.instagram, '', organizationId)
    try {
      this.apiVersion =
        configService.get<string>('FACEBOOK_GRAPH_API_VERSION') || DEFAULT_API_VERSION
    } catch {
      this.apiVersion = DEFAULT_API_VERSION
    }
    this.oauthService = InstagramOAuthService.getInstance()
    this.storageService = new MessageStorageService(organizationId)
  }
  /**
   * Get provider capabilities for Instagram Direct Messages
   */
  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.instagram)
  }
  /**
   * Initializes the provider for a specific integration instance.
   */
  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing InstagramProvider for integration: ${integrationId}`)
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
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    const integration = integrationData
      ? {
          ...integrationData.integration,
          inboxIntegration: integrationData.inboxIntegration,
        }
      : null
    this.inboxId = integration?.inboxIntegration?.inboxId
    // Validate the integration record
    if (
      !integration ||
      integration.provider !== 'instagram' ||
      !integration.enabled ||
      !integration.metadata
    ) {
      this.resetState()
      throw new Error(
        `Active Instagram integration not found, not enabled, or missing metadata for ID: ${integrationId}`
      )
    }
    // Get tokens from encrypted credentials
    const tokens = await getChannelTokens(integrationId)
    // Safely extract and validate metadata and token
    try {
      this.metadata = integration.metadata as unknown as InstagramIntegrationMetadata
      this.pageAccessToken = tokens.accessToken // Decrypted LL Page Token
      this.pageId = this.metadata.pageId
      this.instagramBusinessAccountId = this.metadata.instagramBusinessAccountId
      if (!this.pageId || !this.pageAccessToken || !this.instagramBusinessAccountId) {
        throw new Error('Essential IDs (Page, IGBID) or Page Access Token missing in metadata.')
      }
    } catch (e) {
      this.resetState()
      logger.error('Failed to parse metadata for Instagram integration', {
        integrationId,
        metadata: integration.metadata,
        error: e,
      })
      throw new Error(`Invalid metadata format for Instagram integration ${integrationId}`)
    }
    // Pass integration settings to storage service (they live in metadata)
    const settings = (integration.metadata as { settings?: IntegrationSettings }).settings
    if (settings) {
      this.storageService.setIntegrationSettings(settings)
      logger.info('Integration settings loaded for selective mode', {
        integrationId,
        hasSettings: true,
      })
    }
    // Received-time trigger cutoff (webhook-push-migration plan Phase 2.5; the same
    // contract Gmail/Outlook/Quo use). While the initial backfill is incomplete,
    // ingest stores historical messages but suppresses `message:received` for
    // anything received before the connect epoch — otherwise a backfill mass-fires
    // workflows, agent runs and AI classification against years of real customer
    // mail. Live inbound is unaffected: its `receivedAt` is after the cutoff.
    const socialMeta = integration.metadata as {
      backfillCutoffAt?: string
      initialBackfillCompletedAt?: string
    }
    this.storageService.setBackfillCutoff(
      socialMeta.backfillCutoffAt && !socialMeta.initialBackfillCompletedAt
        ? new Date(socialMeta.backfillCutoffAt)
        : null
    )
    logger.info(
      `InstagramProvider initialized successfully for IGBID: ${this.instagramBusinessAccountId}, Page ID: ${this.pageId}`,
      { integrationId }
    )
  }
  /** Resets the internal state of the provider instance */
  private resetState(): void {
    this.integrationId = null
    this.inboxId = undefined
    this.metadata = null
    this.pageAccessToken = null
    this.pageId = null
    this.instagramBusinessAccountId = null
  }
  /** Ensures the provider is initialized before use */
  private async ensureInitialized(): Promise<void> {
    if (
      !this.integrationId ||
      !this.pageId ||
      !this.pageAccessToken ||
      !this.metadata ||
      !this.instagramBusinessAccountId
    ) {
      if (this.integrationId) {
        logger.warn(
          `Re-initializing Instagram provider due to missing state for ${this.integrationId}`
        )
        await this.initialize(this.integrationId)
      } else {
        throw new Error('InstagramProvider not initialized with an integration ID.')
      }
    }
    // Optional: Check token validity via refreshTokens/debug_token
    // await this.oauthService.refreshTokens(this.integrationId);
  }
  /**
   * Sends a message via the Messenger Platform API for Instagram.
   * options.to is expected to be the recipient's Instagram-Scoped User ID (IGSID).
   */
  async sendMessage(options: SendMessageOptions): Promise<{
    id?: string
    success: boolean
  }> {
    await this.ensureInitialized()
    const recipientIgsid = Array.isArray(options.to) ? options.to[0] : options.to
    if (!recipientIgsid || typeof recipientIgsid !== 'string') {
      throw new Error(
        "Recipient IGSID (Instagram-Scoped User ID) is required in 'to' field for Instagram messages."
      )
    }
    if (!options.text) {
      throw new Error('Instagram message must contain text.')
      // TODO: Handle attachments if needed (complex process involving uploads or asset URLs)
    }
    // Shared with Messenger — see `social/send.ts`.
    //
    // Addressed by the linked **Facebook Page id**, not the IG account id. This
    // preserves what the hand-rolled call did (its comment called the choice out
    // explicitly) and matches WS4 of the plan. Meta has published both shapes over
    // the years — `/{page-id}/messages` for a page-linked IG account under Facebook
    // Login, `/{ig-user-id}/messages` under Instagram Login — and we have never sent
    // an IG message successfully, so this is UNVERIFIED either way. Verify against a
    // real send (gate step 4) before treating it as settled.
    //
    // Note this is a different id from the one the thread key uses: the key is
    // built on the IGBID because that is what the webhook puts in `recipient.id`.
    const { messageId, policy } = await sendSocialMessage({
      platform: 'instagram',
      integrationId: this.integrationId!,
      pageId: this.pageId!,
      pageAccessToken: this.pageAccessToken!,
      recipientId: recipientIgsid,
      text: options.text,
      externalThreadId: options.externalThreadId,
      automated: options.automated,
    })

    logger.info('Instagram message sent successfully', {
      recipientIgsid,
      messageId,
      messagingType: policy.messagingType,
      integrationId: this.integrationId,
    })

    return { id: messageId, success: true }
  }

  /**
   * Subscribe the linked Page to the app's webhook for the `instagram` object.
   *
   * Subscribes on the **Page** id, not the IG account id — that is where Meta
   * holds the subscription for a page-linked Instagram account. App-level config
   * stays manual in the Meta App Dashboard.
   */
  async setupWebhook(_callbackUrl: string): Promise<void> {
    await this.ensureInitialized()
    await subscribePageToApp(
      this.pageId!,
      this.pageAccessToken!,
      SOCIAL_SUBSCRIBED_FIELDS.instagram
    )
    logger.info('Instagram page subscribed to app webhook', {
      integrationId: this.integrationId,
      pageId: this.pageId,
      igBusinessAccountId: this.instagramBusinessAccountId,
      subscribedFields: SOCIAL_SUBSCRIBED_FIELDS.instagram,
    })
  }
  /** Unsubscribe the linked Page from the app's webhook. */
  async removeWebhook(): Promise<void> {
    await this.ensureInitialized()
    await unsubscribePageFromApp(this.pageId!, this.pageAccessToken!)
    logger.info('Instagram page unsubscribed from app webhook', {
      integrationId: this.integrationId,
      pageId: this.pageId,
    })
  }
  /**
   * Synchronizes messages from Instagram via the linked Facebook Page's Conversation API.
   */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()
    logger.info('Starting Instagram message sync', {
      igbid: this.instagramBusinessAccountId,
      pageId: this.pageId,
      since: since?.toISOString(),
      integrationId: this.integrationId,
    })
    try {
      // Use the Conversation API, specifying platform=instagram and the Page ID
      let conversationsLink: string | null =
        `https://graph.facebook.com/${this.apiVersion}/${this.pageId}/conversations?platform=instagram&fields=id,participants{id,username},updated_time,snippet,message_count,unread_count&access_token=${this.pageAccessToken}`
      let totalMessagesProcessed = 0
      const processedConversationIds = new Set<string>() // Avoid reprocessing
      // --- Paginate through Conversations ---
      while (conversationsLink) {
        logger.debug(
          `Fetching Instagram conversations page: ${conversationsLink.split('access_token=')[0]}...`,
          { integrationId: this.integrationId }
        )
        const convoRes = await fetch(conversationsLink)
        const convoData =
          (await convoRes.json()) as InstagramGraphListResponse<InstagramGraphConversation>
        if (!convoRes.ok || convoData.error) {
          logger.error('Failed to fetch Instagram conversations', {
            status: convoRes.status,
            error: convoData.error,
            pageId: this.pageId,
          })
          throw new Error(`Failed to fetch Instagram conversations: ${convoData.error?.message}`)
        }
        const conversations = convoData.data || []
        if (conversations.length === 0) break // Exit conversation loop
        logger.info(`Fetched ${conversations.length} Instagram conversations on this page.`, {
          integrationId: this.integrationId,
        })
        // --- Process Messages within each Conversation ---
        for (const conversation of conversations) {
          const conversationId = conversation.id // FB Conversation ID (our externalThreadId)
          if (!conversationId || processedConversationIds.has(conversationId)) continue
          processedConversationIds.add(conversationId)
          // Check conversation update time against 'since' date
          if (since && conversation.updated_time) {
            const updatedTime = new Date(conversation.updated_time)
            if (updatedTime < since) {
              logger.debug(
                `Skipping IG conversation ${conversationId} updated at ${updatedTime.toISOString()} (before 'since' date ${since.toISOString()})`
              )
              continue
            }
          }
          // Extract user participant info (IGSID and username) from conversation context
          let userContext: {
            igsid: string
            username?: string
          } | null = null
          if (conversation.participants?.data) {
            // Find the participant whose ID is NOT the business account ID (IGBID)
            const userParticipant = conversation.participants.data.find(
              (p: InstagramGraphParticipant) => p.id !== this.instagramBusinessAccountId
            )
            if (userParticipant) {
              userContext = { igsid: userParticipant.id, username: userParticipant.username }
            }
          }
          if (!userContext) {
            logger.warn(
              `Could not determine user IGSID for IG conversation ${conversationId}. Skipping messages.`
            )
            continue
          }
          // --- Paginate through Messages for this Conversation ---
          let messagesLink: string | null =
            `https://graph.facebook.com/${this.apiVersion}/${conversationId}/messages?access_token=${this.pageAccessToken}&fields=id,created_time,from{id,username},to{id,username},message{text,attachments,mid}` // Fetch usernames if available
          const messagesToStore: MessageData[] = []
          // Apply 'since' filter to messages if provided
          if (since) {
            messagesLink += `&since=${Math.floor(since.getTime() / 1000)}`
          }
          while (messagesLink) {
            logger.debug(
              `Fetching messages page for IG conversation ${conversationId}: ${messagesLink.split('access_token=')[0]}...`,
              { integrationId: this.integrationId }
            )
            const msgRes = await fetch(messagesLink)
            const msgData =
              (await msgRes.json()) as InstagramGraphListResponse<InstagramGraphMessage>
            if (!msgRes.ok || msgData.error) {
              logger.error(`Failed to fetch messages for IG conversation ${conversationId}`, {
                status: msgRes.status,
                error: msgData.error,
              })
              messagesLink = null // Stop fetching for this convo
              break
            }
            const messages = msgData.data || []
            if (messages.length === 0) break // Stop if no messages on page
            logger.debug(
              `Fetched ${messages.length} messages for IG conversation ${conversationId} on this page.`,
              { integrationId: this.integrationId }
            )
            for (const message of messages) {
              // Pass user context for correct participant identification
              const converted = this.convertInstagramMessageToMessageData(
                message,
                conversationId,
                userContext
              )
              if (converted) {
                messagesToStore.push(converted)
              }
            }
            messagesLink = msgData.paging?.next ?? null // Next page link for messages
          } // End message pagination
          // --- Store fetched messages ---
          if (messagesToStore.length > 0) {
            const storedCount = await this.storageService.batchStoreMessages(messagesToStore)
            totalMessagesProcessed += storedCount
            logger.info(
              `Stored ${storedCount}/${messagesToStore.length} messages for IG conversation ${conversationId}.`,
              { integrationId: this.integrationId }
            )
          }
        } // End conversation loop
        conversationsLink = convoData.paging?.next ?? null // Next page link for conversations
      } // End conversation pagination
      // Update last synced time on successful completion
      await db
        .update(schema.Integration)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.Integration.id, this.integrationId!))
      logger.info(
        `Instagram sync completed. Processed approximately ${totalMessagesProcessed} messages.`,
        { integrationId: this.integrationId }
      )
    } catch (error: any) {
      logger.error('Error during Instagram message sync:', {
        error: error.message,
        integrationId: this.integrationId,
      })
      // Mark sync attempt time even on failure
      await db
        .update(schema.Integration)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.Integration.id, this.integrationId!))
        .catch((updateErr) =>
          logger.error('Failed to update lastSyncedAt after Instagram sync error', { updateErr })
        )
      throw error // Re-throw
    }
  }
  /**
   * Converts an Instagram message object (from Graph API Conversation edge) to our standard MessageData format,
   * using ParticipantInputData.
   */
  private convertInstagramMessageToMessageData(
    message: any, // Raw message object
    conversationId: string, // FB Conversation ID (externalThreadId)
    userContext: {
      igsid: string
      username?: string
    } // User IGSID and optional username
  ): MessageData | null {
    // Ensure provider state is valid
    if (
      !this.integrationId ||
      !this.instagramBusinessAccountId ||
      !this.metadata?.instagramUsername
    ) {
      logger.error('Provider state invalid during Instagram message conversion.')
      return null
    }
    try {
      // Extract core message details
      const messageContent: InstagramGraphMessageContent = message.message || {}
      const externalId = messageContent.mid || message.id // Use nested 'mid' if available, else top-level 'id'
      const createdTime = new Date(message.created_time)
      // Determine sender using 'from' field
      const sender: InstagramGraphParticipant | undefined = message.from
      if (!sender?.id) {
        logger.warn('Could not determine sender ID for Instagram message', {
          messageId: externalId,
        })
        return null
      }
      let fromInput: ParticipantInputData
      let toInput: ParticipantInputData
      let isInbound = false
      // Check if the sender is the user (IGSID)
      if (sender.id === userContext.igsid) {
        isInbound = true
        fromInput = { identifier: sender.id, name: sender.username ?? userContext.username } // User IGSID + username
        toInput = {
          identifier: this.instagramBusinessAccountId,
          name: this.metadata.instagramUsername,
        } // Business IGBID + username
      }
      // Check if the sender is the business account (IGBID)
      else if (sender.id === this.instagramBusinessAccountId) {
        isInbound = false
        fromInput = {
          identifier: this.instagramBusinessAccountId,
          name: sender.username ?? this.metadata.instagramUsername,
        } // Business IGBID + username
        // Recipient must be the user
        toInput = { identifier: userContext.igsid, name: userContext.username } // User IGSID + username
      } else {
        logger.error('Could not determine participant roles for Instagram message', {
          messageId: externalId,
          senderId: sender.id,
          userIgsid: userContext.igsid,
          igbid: this.instagramBusinessAccountId,
        })
        return null // Skip if roles unclear
      }
      const text = messageContent.text
      // Process attachments
      const attachments = (messageContent.attachments || []).map((att: any) => ({
        filename: att.payload?.title || att.type || 'attachment',
        mimeType: att.type, // FB/IG attachment type
        size: 0, // Size not available
        inline: false,
        contentLocation: att.payload?.url, // URL if available
      }))
      // Construct the MessageData object
      const messageData: MessageData = {
        externalId: externalId,
        // NOT the `t_…` conversation id — the webhook never receives one, so the
        // REST path must derive the SAME pair key the webhook derives or the same
        // conversation lands in two threads. Keyed on the IGBID (our side) so it
        // matches the webhook's `recipient.id`, not on the Page id.
        externalThreadId: socialThreadKey(this.instagramBusinessAccountId, userContext.igsid),
        inboxId: this.inboxId,
        integrationId: this.integrationId,
        organizationId: this.organizationId,
        createdTime: createdTime,
        sentAt: createdTime, // Use created_time as best estimate
        receivedAt: createdTime,
        subject: undefined, // No subject
        from: fromInput, // ParticipantInputData
        to: [toInput], // ParticipantInputData
        cc: [],
        bcc: [],
        replyTo: [],
        // Instagram has no inbound attachment ingestor, so no MessageAttachment
        // rows are ever created and `providerAttachments` is never populated.
        // `hasAttachments` is a workflow trigger filter (see
        // workflow-engine/nodes/trigger-nodes/message-received.ts), so claiming
        // true here fires attachment rules for bytes that were never fetched.
        // The `attachments` local below still drives the snippet fallback.
        hasAttachments: false,
        textPlain: text,
        textHtml: undefined, // No HTML
        snippet: text ? text.substring(0, 100) : attachments[0]?.filename || '',
        isInbound: isInbound,
        metadata: {
          // Store raw parts for reference
          ig_from: message.from,
          ig_to: message.to,
          ig_message: message.message,
          ig_created_time: message.created_time,
        },
        // Default values for non-applicable fields
        keywords: [],
        labelIds: [],
      }
      return messageData
    } catch (error: any) {
      logger.error('Error converting Instagram message object to MessageData', {
        error: error.message,
        messageId: message?.id, // Log raw message ID
        integrationId: this.integrationId,
      })
      return null // Return null on conversion failure
    }
  }
  /** Returns the provider name */
  getProviderName(): string {
    return 'instagram'
  }
  // --- Methods less applicable to Instagram (No-ops or Warnings) ---
  // These remain the same as the previous Facebook provider update,
  // as Instagram Messaging via Messenger Platform has similar limitations.
  async archive(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'archive' operation not directly supported by Instagram provider for ${type} ${externalId}.`
    )
    return false
  }
  async markAsSpam(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'markAsSpam' operation not directly supported by Instagram provider for ${type} ${externalId}.`
    )
    return false
  }
  async trash(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'trash' operation not directly supported by Instagram provider for ${type} ${externalId}.`
    )
    return false
  }
  async restore(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(
      `'restore' operation not directly supported by Instagram provider for ${type} ${externalId}.`
    )
    return false
  }
  async createDraft(options: SendMessageOptions): Promise<{
    id: string
    success: boolean
  }> {
    logger.warn("'createDraft' not applicable to Instagram provider.")
    return { id: '', success: false }
  }
  async updateDraft(draftId: string, options: Partial<SendMessageOptions>): Promise<boolean> {
    logger.warn("'updateDraft' not applicable to Instagram provider.")
    return false
  }
  async sendDraft(draftId: string): Promise<{
    id: string
    success: boolean
  }> {
    logger.warn("'sendDraft' not applicable to Instagram provider.")
    return { id: '', success: false }
  }
  // Instagram doesn't have user-manageable labels/folders in the same way as email.
  // Conversation labels from the linked FB page *might* apply, but require testing.
  async getLabels(): Promise<any[]> {
    logger.info("'getLabels' - Checking linked Facebook Page Conversation Labels for Instagram.")
    // Re-use FB implementation via Page Token
    await this.ensureInitialized()
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/me/custom_labels?fields=name,id,color&access_token=${this.pageAccessToken}`
    try {
      /* ... Fetch labels ... */ return [] /* Return FB labels if applicable */
    } catch (error) {
      /* ... */ return []
    }
  }
  async createLabel(options: { name: string; color?: string }): Promise<any> {
    logger.warn("'createLabel' - Creating linked Facebook Page Conversation Label.")
    // Re-use FB implementation via Page Token
    await this.ensureInitialized()
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/me/custom_labels`
    const params = new URLSearchParams({ name: options.name, access_token: this.pageAccessToken! })
    try {
      /* ... POST request ... */
    } catch (error) {
      /* ... */ throw error
    }
  }
  async updateLabel(
    labelId: string,
    options: {
      name?: string
    }
  ): Promise<boolean> {
    logger.warn(
      `'updateLabel' not supported for Facebook/Instagram label ID ${labelId}. Recreate if needed.`
    )
    return false
  }
  async deleteLabel(labelId: string): Promise<boolean> {
    logger.warn(`'deleteLabel' - Deleting linked Facebook Page Conversation Label ID: ${labelId}`)
    // Re-use FB implementation via Page Token
    await this.ensureInitialized()
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${labelId}?access_token=${this.pageAccessToken}`
    try {
      /* ... DELETE request ... */ return true
    } catch (error) {
      /* ... */ return false
    }
  }
  // Add/Remove labels apply to the FB Conversation ID (thread)
  async addLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    if (type === 'message') {
      /* ... */ return false
    }
    logger.info(`Attempting to add FB label ${labelId} to IG conversation ${externalId}`)
    // Re-use FB implementation
    await this.ensureInitialized()
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${externalId}/custom_labels`
    const params = new URLSearchParams({ label_id: labelId, access_token: this.pageAccessToken! })
    try {
      /* ... POST request ... */ return true
    } catch (error) {
      /* ... */ return false
    }
  }
  async removeLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    if (type === 'message') {
      /* ... */ return false
    }
    logger.info(`Attempting to remove FB label ${labelId} from IG conversation ${externalId}`)
    // Re-use FB implementation
    await this.ensureInitialized()
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${externalId}/custom_labels`
    const params = new URLSearchParams({ label_id: labelId, access_token: this.pageAccessToken! })
    try {
      /* ... DELETE request ... */ return true
    } catch (error) {
      /* ... */ return false
    }
  }
  // Get Thread Metadata (FB Conversation ID)
  async getThread(externalThreadId: string): Promise<any> {
    logger.info(
      `Getting Instagram conversation info (via FB Conversation API) for: ${externalThreadId}`
    )
    // Re-use FB implementation
    await this.ensureInitialized()
    const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${externalThreadId}?fields=id,participants{id,username},updated_time,snippet,message_count,unread_count,link&access_token=${this.pageAccessToken}`
    try {
      /* ... GET request ... */
    } catch (error) {
      /* ... */ throw error
    }
  }
  // Status updates not directly applicable
  async updateThreadStatus(externalThreadId: string, status: MessageStatus): Promise<boolean> {
    logger.warn(
      `'updateThreadStatus' (${status}) not directly supported for Instagram conversation ${externalThreadId}.`
    )
    return false
  }
  // Moving thread maps to adding FB conversation labels
  async moveThread(externalThreadId: string, destinationLabelId: string): Promise<boolean> {
    logger.info(
      `'moveThread' requested for IG conversation ${externalThreadId} to FB label ${destinationLabelId}. Attempting addLabel.`
    )
    return this.addLabel(destinationLabelId, externalThreadId, 'thread')
  }
  // Simulation not applicable
  async simulateOperation(operation: string, targetId: string, params?: any): Promise<any> {
    logger.warn('simulateOperation is not implemented for InstagramProvider')
    return Promise.resolve({ success: false, message: 'Not implemented' })
  }
}
