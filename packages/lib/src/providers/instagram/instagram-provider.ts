// src/lib/providers/instagram/instagram-provider.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
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
import { type InstagramIntegrationMetadata, InstagramOAuthService } from './instagram-oauth'

const logger = createScopedLogger('instagram-provider')
// v19.0 is past deprecation — Graph silently answers as a current version
// (observed live 2026-08-17: `paging.next` links came back stamped v25.0).
const DEFAULT_API_VERSION = 'v26.0'

/**
 * `Integration.metadata` as this provider reads it: the OAuth/page identity plus the
 * backfill bookkeeping `social/sync.ts` owns.
 */
type InstagramProviderMetadata = InstagramIntegrationMetadata & SocialSyncMetadata

export class InstagramProvider
  extends BaseMessageProvider
  implements ChannelProvider, MessageProvider
{
  private inboxId: string | undefined = undefined // Store inbox ID
  private metadata: InstagramProviderMetadata | null = null
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
      this.metadata = integration.metadata as unknown as InstagramProviderMetadata
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
    this.storageService.setBackfillCutoff(resolveSocialBackfillCutoff(this.metadata))
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
   * Backfills / catches up Instagram Direct history for this business account.
   *
   * Same walk as Messenger (`social/sync.ts`) over the same Page edge, with two
   * differences that matter: `platform=instagram`, and **our identity in the thread key
   * is the IG business account id, not the Page id** — that is what the IG webhook puts
   * in `recipient.id`, and a key that used the Page id here would fork every
   * conversation the webhook has already stored.
   */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()
    await syncSocialMessages({
      target: {
        platform: 'instagram',
        graphPlatform: 'instagram',
        // The conversations edge is addressed on the linked FB Page even for IG.
        pageId: this.pageId!,
        ourId: this.instagramBusinessAccountId!,
        ourName: this.metadata?.instagramUsername,
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
