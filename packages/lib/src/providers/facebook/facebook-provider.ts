// src/lib/providers/facebook/facebook-provider.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import {
  type IntegrationSettings, // Per-integration record-creation/filter settings
  MessageStorageService,
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
import {
  resolveSocialBackfillCutoff,
  type SocialSyncMetadata,
  syncSocialMessages,
} from '../social/sync'
import { type FacebookIntegrationMetadata, FacebookOAuthService } from './facebook-oauth'

const logger = createScopedLogger('facebook-provider')
// v19.0 is past deprecation — Graph silently answers as a current version
// (observed live 2026-08-17: `paging.next` links came back stamped v25.0).
const DEFAULT_API_VERSION = 'v26.0'

/**
 * `Integration.metadata` as this provider reads it: the OAuth/page identity plus the
 * backfill bookkeeping `social/sync.ts` owns.
 */
type FacebookProviderMetadata = FacebookIntegrationMetadata & SocialSyncMetadata

export class FacebookProvider
  extends BaseMessageProvider
  implements ChannelProvider, MessageProvider
{
  private inboxId: string | undefined = undefined
  private metadata: FacebookProviderMetadata | null = null
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
    const tokens = await getChannelTokens(integrationId)
    // Safely cast and extract metadata
    try {
      this.metadata = integration.metadata as unknown as FacebookProviderMetadata
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
    // Pass integration settings to storage service (they live in metadata)
    const settings = (integration.metadata as { settings?: IntegrationSettings }).settings
    if (settings) {
      this.storageService.setIntegrationSettings(settings)
      logger.info('Integration settings loaded for selective mode', {
        integrationId,
        hasSettings: true,
      })
    }
    this.storageService.setBackfillCutoff(resolveSocialBackfillCutoff(this.metadata))
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
    // One attachment per message, never beside text: Meta's `message` object takes
    // `text` OR `attachment`. `MessageSenderService` has already split a composer
    // send that needs both, so anything arriving here is a single message —
    // extra attachments would be silently dropped, so refuse them instead.
    const attachment = options.attachments?.[0]
    if (options.attachments && options.attachments.length > 1) {
      throw new Error(
        'Meta accepts one attachment per message; the send should have been split upstream.'
      )
    }
    if (!options.text && !attachment) {
      throw new Error('A message must contain text or an attachment.')
    }
    // Messaging-window policy (24h `RESPONSE`, `HUMAN_AGENT` outside it, automation
    // blocked outside it) plus the Graph call itself live in `social/send.ts` so
    // both channels share one implementation and the policy is unit-testable.
    const { messageId, policy } = await sendSocialMessage({
      platform: 'facebook',
      integrationId: this.integrationId!,
      pageId: this.pageId!,
      pageAccessToken: this.pageAccessToken!,
      recipientId: recipientPsid,
      text: attachment ? undefined : options.text,
      attachment: attachment
        ? {
            content: Buffer.isBuffer(attachment.content)
              ? attachment.content
              : Buffer.from(attachment.content),
            filename: attachment.filename,
            contentType: attachment.contentType,
          }
        : undefined,
      externalThreadId: options.externalThreadId,
      automated: options.automated,
    })

    logger.info('Facebook message sent successfully', {
      recipientPsid,
      messageId,
      messagingType: policy.messagingType,
      integrationId: this.integrationId,
    })

    // The `mid` is the same id space the webhook echo and the REST sync use, so
    // stamping it as `externalId` is what makes `(integrationId, externalId)`
    // dedupe this send across all three doors.
    return { id: messageId, success: true }
  }

  /**
   * Subscribe this Page to the app's webhook.
   *
   * Real work now, not a log line. The APP-level config (callback URL, verify
   * token, which objects the app listens to) stays manual in the Meta App
   * Dashboard — only the per-page subscription is ours to arm, and it is the half
   * that goes missing when a page is reconnected or a token is refreshed silently.
   *
   * `callbackUrl` is accepted for interface parity and deliberately unused: Meta
   * has no per-page callback: every page on the app posts to the app's one URL.
   */
  async setupWebhook(_callbackUrl: string): Promise<void> {
    await this.ensureInitialized()
    await subscribePageToApp(this.pageId!, this.pageAccessToken!, SOCIAL_SUBSCRIBED_FIELDS.facebook)
    logger.info('Facebook page subscribed to app webhook', {
      integrationId: this.integrationId,
      pageId: this.pageId,
      subscribedFields: SOCIAL_SUBSCRIBED_FIELDS.facebook,
    })
  }
  /** Unsubscribe this Page from the app's webhook — real `DELETE`, not a log line. */
  async removeWebhook(): Promise<void> {
    await this.ensureInitialized()
    await unsubscribePageFromApp(this.pageId!, this.pageAccessToken!)
    logger.info('Facebook page unsubscribed from app webhook', {
      integrationId: this.integrationId,
      pageId: this.pageId,
    })
  }
  /**
   * Backfills / catches up Messenger history for this Page.
   *
   * The walk itself lives in `social/sync.ts` because Messenger and Instagram Direct
   * are the same ladder over the same edge, differing only in the `platform` param and
   * in which id counts as "us". What used to be here — ~180 lines of raw `fetch` with
   * the access token in the query string, a `since` filter applied *after* paginating
   * all 500+ conversations, and `fields=message{text,attachments,mid}` expanding a
   * scalar — is gone rather than repaired.
   */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()
    await syncSocialMessages({
      target: {
        platform: 'facebook',
        graphPlatform: 'messenger',
        pageId: this.pageId!,
        // On Messenger the Page id is both the addressable edge and our identity in
        // the thread key — the two coincide here and do NOT on Instagram.
        ourId: this.pageId!,
        ourName: this.metadata?.pageName,
        pageAccessToken: this.pageAccessToken!,
        integrationId: this.integrationId!,
        organizationId: this.organizationId,
        inboxId: this.inboxId,
      },
      metadata: this.metadata!,
      storage: this.storageService,
      since,
    })
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
