// src/lib/providers/google/google-provider.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { type Common, type gmail_v1 as GmailV1, google } from 'googleapis'
import { MessageStorageService } from '../../email/email-storage'
import {
  CircuitBreakerError,
  createThrottler,
  RateLimitError,
  type UniversalThrottler,
} from '../../utils/rate-limiter'
import type {
  ChannelProvider,
  MessageListResult,
  MessageStatus,
  SendMessageOptions,
} from '../channel-provider.interface'
import { ChannelTokenAccessor } from '../channel-token-accessor'
import {
  BaseMessageProvider,
  type MessageProvider,
  type ProviderLabel,
} from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'
import { GoogleOAuthService } from './google-oauth'

type GaxiosError = Common.GaxiosError

import { IntegrationProviderType } from '@auxx/database/enums'
import { getGmailQuotaCost } from '../../utils/rate-limiter'
import { createGmailDraft, sendGmailDraft, updateGmailDraft } from './drafts'
import { addLabel, createLabel, deleteLabel, getLabels, removeLabel, updateLabel } from './labels'
// Import modular functions
import { getMessagesBatch } from './messages/batch-fetch'
import { createEmailMessage } from './messages/create-message'
import { GmailInboundContentIngestor } from './messages/gmail-inbound-content-ingestor'
import { convertMessagesToMessageData } from './messages/parse-message'
import { sendGmailMessage } from './messages/send-message'
import { syncGmailMessages } from './messages/sync-messages'
import { archive, markAsSpam, restore, trash } from './operations'
import { executeWithThrottle } from './shared/utils'
import { getThread, moveThread, updateThreadStatus } from './threads'
import { removeWebhook, setupWebhook } from './webhooks'

const logger = createScopedLogger('google-provider')

/** De-duped, lowercased union of an integration's own email addresses. */
function mergeOwnEmails(primary: string | null | undefined, aliases: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string | null | undefined) => {
    if (!raw) return
    const normalized = raw.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }
  add(primary)
  for (const alias of aliases) add(alias)
  return out
}

export class GoogleProvider
  extends BaseMessageProvider
  implements ChannelProvider, MessageProvider
{
  private client: any // Should be google.auth.OAuth2
  private gmail: GmailV1.Gmail | null = null
  private inboxId: string | undefined = undefined
  private integration:
    | (typeof schema.Integration.$inferSelect & { inboxIntegration?: any })
    | null = null
  private storageService: MessageStorageService
  private userEmails: string[] = []
  private throttler: UniversalThrottler | null = null

  constructor(organizationId: string) {
    super(IntegrationProviderType.google, '', organizationId)
    this.storageService = new MessageStorageService(organizationId)
  }
  /**
   * Get provider capabilities for Google/Gmail
   */
  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.google)
  }
  /**
   * Initializes the Google provider for a specific integration.
   */
  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing GoogleProvider for integration: ${integrationId}`)
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
    logger.info(`Inbox Id is : ${this.inboxId}`)
    if (!this.inboxId) {
      logger.error(`No inbox integration found for Google integration ID: ${integrationId}`)
      throw new Error('Inbox integration not found.')
    }
    if (!integration || integration.provider !== 'google' || !integration.enabled) {
      this.resetState()
      throw new Error(`Active Google integration not found or not enabled for ID: ${integrationId}`)
    }
    // Get tokens from encrypted credentials
    const tokens = await ChannelTokenAccessor.getTokens(integrationId)
    if (!tokens.refreshToken) {
      this.resetState()
      throw new Error(`Missing refresh token for Google integration ID: ${integrationId}`)
    }
    // Store integration details locally
    this.integration = integration
    // Pass integration settings to storage service (now in metadata)
    if (integration.metadata && typeof integration.metadata === 'object') {
      const metadata = integration.metadata as any
      if (metadata.settings) {
        this.storageService.setIntegrationSettings(metadata.settings)
        logger.info(`Integration settings loaded for selective mode`, {
          integrationId: this.integrationId,
          hasSettings: true,
        })
      }
    }
    // Get authenticated client from OAuth service using decrypted tokens
    const { client: authClient } = await GoogleOAuthService.getAuthenticatedClientForOrg(
      this.organizationId,
      tokens
    )
    this.client = authClient
    this.setupTokenListener() // Set up listener for token updates
    // Initialize Gmail API client
    this.gmail = google.gmail({ version: 'v1', auth: this.client })
    // Initialize rate limiter
    this.throttler = await createThrottler(IntegrationProviderType.google)
    logger.info('Rate limiter initialized for Google provider', {
      integrationId: this.integrationId,
    })
    // Fetch and cache all user email addresses (primary + verified send-as).
    // Defensively include `Integration.email` as well — `userEmails` is derived
    // from `metadata.email` and the Gmail send-as list, so the two should
    // already overlap, but covering both columns guarantees the integration
    // owner's mailbox is always treated as internal.
    this.userEmails = mergeOwnEmails(integration.email, await this.fetchAllUserEmails())
    // Surface the canonical "us" address set to the ingest pipeline so
    // self-addressed mail never produces a contact for the integration owner.
    this.storageService.setOwnEmails(this.userEmails)
    logger.info(`GoogleProvider initialized successfully for integration: ${integrationId}`, {
      userEmailsCount: this.userEmails.length,
    })
  }
  /** Resets the internal state */
  private resetState(): void {
    this.integrationId = null
    this.integration = null
    this.client = null
    this.gmail = null
    this.userEmails = []
    this.throttler = null
  }
  /**
   * Fetches all user email addresses (primary + send-as) and stores in metadata
   */
  private async fetchAllUserEmails(forceRefresh: boolean = false): Promise<string[]> {
    // Check if we have cached emails in metadata and they're fresh
    if (!forceRefresh && this.integration?.metadata) {
      const metadata = this.integration.metadata as any
      if (metadata.userEmails && Array.isArray(metadata.userEmails)) {
        // Check if cache is still fresh (24 hours)
        const lastFetch = metadata.lastEmailsFetch ? new Date(metadata.lastEmailsFetch) : null
        const isFresh = lastFetch && Date.now() - lastFetch.getTime() < 24 * 60 * 60 * 1000
        if (isFresh) {
          logger.debug('Using cached user emails from metadata', {
            count: metadata.userEmails.length,
            integrationId: this.integrationId,
          })
          return metadata.userEmails
        }
      }
    }
    const emails: Set<string> = new Set()
    // 1. Add primary email from metadata
    const primaryEmail = this.getPrimaryEmail()
    if (primaryEmail) {
      emails.add(primaryEmail.toLowerCase())
    }
    try {
      // 2. Fetch all send-as addresses from Gmail API
      await this.ensureInitialized()
      const sendAsResponse = await executeWithThrottle(
        'gmail.settings.sendAs.list',
        async () =>
          this.gmail!.users.settings.sendAs.list({
            userId: 'me',
          }),
        {
          userId: this.integrationId!,
          throttler: this.throttler!,
          priority: 10, // Low priority
        }
      )
      if (sendAsResponse.data.sendAs) {
        for (const sendAs of sendAsResponse.data.sendAs) {
          if (sendAs.verificationStatus === 'accepted' && sendAs.sendAsEmail) {
            emails.add(sendAs.sendAsEmail.toLowerCase())
          }
        }
      }
      const emailArray = Array.from(emails)
      logger.info(`Found ${emails.size} email addresses for user`, {
        emails: emailArray,
        integrationId: this.integrationId,
      })
      // 3. Store emails in integration metadata for persistence
      if (this.integrationId) {
        await this.updateIntegrationMetadata({
          userEmails: emailArray,
          lastEmailsFetch: new Date().toISOString(),
        })
      }
      return emailArray
    } catch (error) {
      logger.warn('Failed to fetch send-as addresses, using cached or primary email', {
        error,
        integrationId: this.integrationId,
      })
      // Fallback to cached emails if available
      if (this.integration?.metadata) {
        const metadata = this.integration.metadata as any
        if (metadata.userEmails && Array.isArray(metadata.userEmails)) {
          return metadata.userEmails
        }
      }
      // Last resort: return just the primary email
      return primaryEmail ? [primaryEmail.toLowerCase()] : []
    }
  }
  /**
   * Updates integration metadata
   */
  private async updateIntegrationMetadata(updates: Record<string, any>): Promise<void> {
    if (!this.integrationId) return
    try {
      const currentMetadata = (this.integration?.metadata || {}) as any
      const newMetadata = {
        ...currentMetadata,
        ...updates,
      }
      await db
        .update(schema.Integration)
        .set({ metadata: newMetadata })
        .where(eq(schema.Integration.id, this.integrationId))
      // Update local cache
      if (this.integration) {
        this.integration.metadata = newMetadata
      }
      logger.debug('Updated integration metadata', {
        integrationId: this.integrationId,
        updates,
      })
    } catch (error) {
      logger.error('Failed to update integration metadata', {
        error,
        integrationId: this.integrationId,
      })
    }
  }
  /**
   * Gets the primary email from integration metadata
   */
  private getPrimaryEmail(): string | undefined {
    if (!this.integration?.metadata) return undefined
    const metadata = this.integration.metadata as any
    if (typeof metadata === 'object' && 'email' in metadata) {
      return metadata.email as string
    }
    return undefined
  }
  /** Sets up the listener for token refresh events from the OAuth client */
  private setupTokenListener(): void {
    if (!this.client) return
    this.client.on('tokens', (tokens: any) => {
      if (!this.integrationId || !this.integration) {
        logger.warn('Token update received but provider state is invalid.')
        return
      }
      const integrationId = this.integrationId
      logger.info('Google OAuth tokens refreshed.', { integrationId })

      const tokenUpdate: Parameters<typeof ChannelTokenAccessor.setTokens>[1] = {
        accessToken: tokens.access_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      }
      if (tokens.refresh_token) {
        logger.info('Received new Google refresh token.', { integrationId })
        tokenUpdate.refreshToken = tokens.refresh_token
      }

      // Update local cache
      if (this.integration) {
        this.integration.expiresAt = tokenUpdate.expiresAt ?? null
      }

      // Persist encrypted tokens asynchronously
      ChannelTokenAccessor.setTokens(integrationId, tokenUpdate)
        .then(() => logger.debug('Successfully updated Google tokens.', { integrationId }))
        .catch((err) =>
          logger.error('Failed to update Google tokens', { integrationId, error: err })
        )
    })
  }
  /** Ensures the provider is initialized */
  private async ensureInitialized(): Promise<void> {
    if (!this.gmail || !this.client || !this.integrationId || !this.integration) {
      if (this.integrationId) {
        logger.warn(`Re-initializing Google provider for ${this.integrationId}`)
        await this.initialize(this.integrationId)
      } else {
        throw new Error('GoogleProvider not initialized with an integration ID.')
      }
    }
    // Optional: Check token validity before proceeding
    await this.checkTokenValidity()
  }
  /** Checks token validity and attempts refresh if nearing expiry */
  private async checkTokenValidity(): Promise<void> {
    if (!this.client || !this.integration?.expiresAt || !this.integrationId) return
    // Check if token is expired or nearing expiry (e.g., within 5 minutes)
    const buffer = 5 * 60 * 1000
    if (this.integration.expiresAt.getTime() - buffer >= Date.now()) return

    logger.info('Google access token nearing expiry or expired, attempting refresh...', {
      integrationId: this.integrationId,
    })

    // Use GoogleOAuthService.refreshTokens — it awaits the encrypted-credential
    // write before returning, unlike the OAuth client's `tokens` event listener
    // which fires-and-forgets the persistence and risks the next API call
    // hitting an `invalid_grant` against a stale in-memory token.
    // Errors here are already routed through AuthErrorHandler inside refreshTokens.
    await GoogleOAuthService.refreshTokens(this.integrationId)

    // Reload the persisted tokens into the in-memory OAuth2 client so the
    // upcoming Gmail API call uses the freshly-rotated access token.
    const tokens = await ChannelTokenAccessor.getTokens(this.integrationId)
    this.client.setCredentials({
      refresh_token: tokens.refreshToken || undefined,
      access_token: tokens.accessToken || undefined,
      expiry_date: tokens.expiresAt ? tokens.expiresAt.getTime() : undefined,
    })
    if (this.integration) {
      this.integration.expiresAt = tokens.expiresAt
    }

    logger.info('Google access token refreshed successfully during validity check.', {
      integrationId: this.integrationId,
    })
  }
  /**
   * Sends an email using the Gmail API.
   */
  async sendMessage(options: SendMessageOptions): Promise<{
    id: string
    success: boolean
    threadId?: string
    historyId?: string
    labelIds?: string[]
  }> {
    await this.ensureInitialized()
    logger.info('Sending email via Gmail API', { options })

    try {
      // Ensure contacts exist for recipients in selective mode
      const recipients = [
        ...(options.to || []),
        ...(options.cc || []),
        ...(options.bcc || []),
      ].filter(Boolean)

      if (recipients.length > 0 && this.organizationId) {
        await this.storageService.ensureContactsForRecipients(
          recipients,
          this.organizationId,
          IntegrationProviderType.google
        )
      }

      // Validate and prepare from address
      const validatedFrom = await this.validateFromAddress(options.from)

      // Create RFC 822 formatted email message
      const message = await createEmailMessage({
        ...options,
        from: validatedFrom,
      })

      // Send message via Gmail API
      const result = await sendGmailMessage({
        gmail: this.gmail!,
        message,
        threadId: options.externalThreadId,
        integrationId: this.integrationId!,
        throttler: this.throttler!,
      })

      return {
        id: result.id,
        success: true,
        threadId: result.threadId,
        historyId: result.historyId,
        labelIds: result.labelIds,
      }
    } catch (error: any) {
      // Handle rate limiting errors
      if (error instanceof RateLimitError || error instanceof CircuitBreakerError) {
        this.handleRateLimitError(error, 'sendMessage')
        throw error
      }
      throw error
    }
  }
  /** Sets up Gmail push notifications (watch). */
  async setupWebhook(/* callbackUrl?: string */): Promise<void> {
    await this.ensureInitialized()

    await setupWebhook({
      gmail: this.gmail!,
      integrationId: this.integrationId!,
      integration: this.integration! as any,
    })
  }

  /** Removes the Gmail watch. */
  async removeWebhook(): Promise<void> {
    await this.ensureInitialized()

    await removeWebhook({
      gmail: this.gmail!,
      integrationId: this.integrationId!,
    })
  }
  /** Synchronizes messages from Gmail using history records or listing. */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()

    try {
      const accessToken = await this.getAccessToken()
      const result = await syncGmailMessages({
        gmail: this.gmail!,
        integrationId: this.integrationId!,
        inboxId: this.inboxId!,
        organizationId: this.organizationId,
        lastHistoryId: this.integration!.lastHistoryId,
        since,
        throttler: this.throttler!,
        storageService: this.storageService,
        userEmails: this.userEmails,
        accessToken,
      })

      // Update local cache
      if (this.integration) {
        this.integration.lastHistoryId = result.newHistoryId
        this.integration.lastSyncedAt = new Date()
      }

      logger.info('Gmail sync completed successfully', {
        integrationId: this.integrationId,
        messagesProcessed: result.messagesProcessed,
        newHistoryId: result.newHistoryId,
      })
    } catch (error: any) {
      // Handle rate limiting errors
      if (error instanceof RateLimitError || error instanceof CircuitBreakerError) {
        this.handleRateLimitError(error, 'syncMessages')
      }
      throw error
    }
  }
  // --- Helper Methods ---
  /** Gets the current access token, ensures provider is initialized */
  async getAccessToken(): Promise<string> {
    await this.ensureInitialized()
    if (!this.client.credentials.access_token) {
      logger.error('No Google access token available after initialization/check.', {
        integrationId: this.integrationId,
      })
      throw new Error('Missing Google access token.')
    }
    return this.client.credentials.access_token
  }
  /**
   * Validates From address against send-as addresses
   */
  private async validateFromAddress(from: string): Promise<string> {
    try {
      // Get send-as addresses for this account
      const sendAsResponse = await this.gmail!.users.settings.sendAs.list({
        userId: 'me',
      })
      const sendAsAddresses = sendAsResponse.data.sendAs || []
      const validAddress = sendAsAddresses.find((sa) => sa.sendAsEmail === from)
      if (!validAddress) {
        // Auto-select primary address or fail
        const primary = sendAsAddresses.find((sa) => sa.isPrimary)
        if (primary?.sendAsEmail) {
          logger.warn(
            `From address "${from}" not in send-as list, using primary: ${primary.sendAsEmail}`
          )
          return primary.sendAsEmail
        }
        throw new Error(`From address "${from}" is not a verified send-as address for this account`)
      }
      return from
    } catch (error) {
      // If we can't validate, just return the from address
      logger.warn('Could not validate from address', { from, error })
      return from
    }
  }
  /** Returns the provider name */
  getProviderName(): string {
    return 'google'
  }

  /**
   * Helper method to handle rate limit and circuit breaker errors
   */
  private handleRateLimitError(error: any, operation: string): void {
    if (error instanceof RateLimitError) {
      logger.warn('Rate limit hit for Google provider', {
        operation,
        provider: IntegrationProviderType.google,
        integrationId: this.integrationId,
        retryAfter: error.retryAfter,
      })
    } else if (error instanceof CircuitBreakerError) {
      logger.error('Circuit breaker open for Google provider', {
        operation,
        provider: IntegrationProviderType.google,
        integrationId: this.integrationId,
        state: error.state,
      })
    }
  }
  // --- Operations ---
  async archive(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    return archive(this.gmail!, externalId, type, this.integrationId!, this.throttler!)
  }

  async markAsSpam(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    return markAsSpam(this.gmail!, externalId, type, this.integrationId!, this.throttler!)
  }

  async trash(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    return trash(this.gmail!, externalId, type, this.integrationId!, this.throttler!)
  }

  async restore(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    await this.ensureInitialized()
    return restore(this.gmail!, externalId, type, this.integrationId!, this.throttler!)
  }
  // --- Drafts ---
  async createDraft(options: SendMessageOptions): Promise<{
    id: string
    success: boolean
  }> {
    await this.ensureInitialized()

    // Validate and create message
    const validatedFrom = await this.validateFromAddress(options.from)
    const message = await createEmailMessage({
      ...options,
      from: validatedFrom,
    })

    const result = await createGmailDraft({
      gmail: this.gmail!,
      message,
      threadId: options.externalThreadId,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })

    return { id: result.id, success: true }
  }

  async updateDraft(draftId: string, options: Partial<SendMessageOptions>): Promise<boolean> {
    await this.ensureInitialized()

    // Validate and create message
    const validatedFrom = await this.validateFromAddress(options.from!)
    const message = await createEmailMessage({
      ...(options as SendMessageOptions),
      from: validatedFrom,
    })

    return updateGmailDraft({
      gmail: this.gmail!,
      draftId,
      message,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }

  async sendDraft(draftId: string): Promise<{
    id: string
    success: boolean
  }> {
    await this.ensureInitialized()

    const result = await sendGmailDraft({
      gmail: this.gmail!,
      draftId,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })

    return { id: result.id, success: true }
  }
  // --- Labels ---
  async getLabels(): Promise<ProviderLabel[]> {
    await this.ensureInitialized()

    const labels = await getLabels({
      gmail: this.gmail!,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })

    // Map Gmail labels to ProviderLabel format
    return labels
      .filter((label) => label.id && label.name)
      .map((label) => ({
        id: label.id!,
        name: label.name!,
        color: label.color?.backgroundColor || undefined,
        type: label.type === 'system' ? ('system' as const) : ('user' as const),
      }))
  }

  async createLabel(options: { name: string; color?: string; visible?: boolean }): Promise<any> {
    await this.ensureInitialized()

    return createLabel({
      gmail: this.gmail!,
      name: options.name,
      color: options.color,
      visible: options.visible ?? true,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
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
    return updateLabel({
      gmail: this.gmail!,
      labelId,
      name: options.name,
      color: options.color,
      visible: options.visible,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }

  async deleteLabel(labelId: string): Promise<boolean> {
    await this.ensureInitialized()
    return deleteLabel({
      gmail: this.gmail!,
      labelId,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }

  async addLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    await this.ensureInitialized()

    return addLabel({
      gmail: this.gmail!,
      labelId,
      externalId,
      type,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }

  async removeLabel(
    labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    await this.ensureInitialized()

    return removeLabel({
      gmail: this.gmail!,
      labelId,
      externalId,
      type,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }
  // --- Threads ---
  async getThread(externalThreadId: string): Promise<GmailV1.Schema$Thread> {
    await this.ensureInitialized()
    return getThread({
      gmail: this.gmail!,
      externalThreadId,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }

  async updateThreadStatus(externalThreadId: string, status: MessageStatus): Promise<boolean> {
    await this.ensureInitialized()
    return updateThreadStatus({
      gmail: this.gmail!,
      externalThreadId,
      status,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }

  async moveThread(externalThreadId: string, destinationLabelId: string): Promise<boolean> {
    await this.ensureInitialized()
    return moveThread({
      gmail: this.gmail!,
      externalThreadId,
      destinationLabelId,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })
  }
  // --- Two-Phase Polling Sync ---

  supportsTwoPhaseSync(): boolean {
    return true
  }

  async discoverLabels(): Promise<
    { externalId: string; name: string; isSentBox: boolean; parentExternalId: string | null }[]
  > {
    await this.ensureInitialized()

    const labels = await getLabels({
      gmail: this.gmail!,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })

    // Filter out system category labels (e.g. CATEGORY_PROMOTIONS)
    return labels
      .filter((label) => label.id && label.name && !label.id.startsWith('CATEGORY_'))
      .map((label) => ({
        externalId: label.id!,
        name: label.name!,
        isSentBox: label.id === 'SENT',
        parentExternalId: null, // Gmail labels are flat
      }))
  }

  async fetchMessageIds(since?: Date): Promise<MessageListResult[]> {
    await this.ensureInitialized()

    const lastHistoryId = this.integration!.lastHistoryId
    const addedMessageIds: string[] = []
    const deletedMessageIds: string[] = []
    let newHistoryId = lastHistoryId || '0'

    if (lastHistoryId && !since) {
      // Incremental sync via History API
      let nextPageToken: string | undefined | null
      let highestHistoryId = BigInt(lastHistoryId)

      do {
        const historyResponse = await executeWithThrottle(
          'gmail.history.list',
          async () =>
            this.gmail!.users.history.list({
              userId: 'me',
              startHistoryId: highestHistoryId.toString(),
              pageToken: nextPageToken ?? undefined,
              historyTypes: ['messageAdded', 'messageDeleted', 'labelRemoved'],
            }),
          {
            userId: this.integrationId!,
            throttler: this.throttler!,
            cost: getGmailQuotaCost('history.list'),
            queue: true,
            priority: 5,
          }
        )

        const historyRecords = historyResponse.data.history || []

        for (const record of historyRecords) {
          if (record.messagesAdded) {
            for (const msgAdded of record.messagesAdded) {
              if (msgAdded.message?.id) {
                addedMessageIds.push(msgAdded.message.id)
              }
            }
          }
          if (record.messagesDeleted) {
            for (const msgDeleted of record.messagesDeleted) {
              if (msgDeleted.message?.id) {
                deletedMessageIds.push(msgDeleted.message.id)
              }
            }
          }
          // Treat INBOX label removal as deletion (archived messages)
          if (record.labelsRemoved) {
            for (const labelChange of record.labelsRemoved) {
              if (labelChange.labelIds?.includes('INBOX') && labelChange.message?.id) {
                deletedMessageIds.push(labelChange.message.id)
              }
            }
          }
          const recordHistoryId = BigInt(record.id ?? '0')
          if (recordHistoryId > highestHistoryId) {
            highestHistoryId = recordHistoryId
          }
        }

        if (historyRecords.length === 0 && historyResponse.data.historyId) {
          const currentHistoryId = BigInt(historyResponse.data.historyId)
          if (currentHistoryId > highestHistoryId) {
            highestHistoryId = currentHistoryId
          }
        }

        nextPageToken = historyResponse.data.nextPageToken
      } while (nextPageToken)

      newHistoryId = highestHistoryId.toString()
    } else {
      // Full sync via Message List API. Empty `q` (combined with the existing
      // `includeSpamTrash: false` below) pulls INBOX + SENT + every other
      // non-trash/non-spam label — `in:inbox` would silently drop the user's
      // own SENT messages, which the polling pipeline relies on to thread
      // outbound replies and create recipient contacts.
      const query = since ? `after:${Math.floor(since.getTime() / 1000)}` : ''
      let nextPageToken: string | undefined | null
      let highestHistoryId = BigInt(0)

      do {
        const listResponse = await executeWithThrottle(
          'gmail.messages.list',
          async () =>
            this.gmail!.users.messages.list({
              userId: 'me',
              q: query,
              pageToken: nextPageToken ?? undefined,
              includeSpamTrash: false,
              maxResults: 100,
            }),
          {
            userId: this.integrationId!,
            throttler: this.throttler!,
            cost: getGmailQuotaCost('messages.list'),
            queue: true,
            priority: 5,
          }
        )

        const messages = listResponse.data.messages || []
        if (messages.length === 0) break

        for (const msg of messages) {
          if (msg.id) addedMessageIds.push(msg.id)
        }

        // We need to get historyId from the first batch of actual messages
        const firstMsg = messages[0]
        if (highestHistoryId === BigInt(0) && firstMsg?.id) {
          // Fetch one message to get its historyId for cursor tracking
          const firstMsgId = firstMsg.id
          const sampleMsg = await executeWithThrottle(
            'gmail.messages.get',
            async () =>
              this.gmail!.users.messages.get({
                userId: 'me',
                id: firstMsgId,
                format: 'minimal',
              }),
            {
              userId: this.integrationId!,
              throttler: this.throttler!,
              cost: getGmailQuotaCost('messages.get'),
              queue: true,
              priority: 5,
            }
          )
          if (sampleMsg.data.historyId) {
            highestHistoryId = BigInt(sampleMsg.data.historyId)
          }
        }

        nextPageToken = listResponse.data.nextPageToken
      } while (nextPageToken)

      newHistoryId = highestHistoryId.toString()
    }

    // Deduplicate: messages in both added and deleted → net result is deleted
    const deletedSet = new Set(deletedMessageIds)
    const uniqueAddedIds = [...new Set(addedMessageIds)].filter((id) => !deletedSet.has(id))
    const uniqueDeletedIds = [...deletedSet]

    logger.info('fetchMessageIds completed', {
      integrationId: this.integrationId,
      addedCount: uniqueAddedIds.length,
      deletedCount: uniqueDeletedIds.length,
      newHistoryId,
    })

    return [
      {
        messageIds: uniqueAddedIds,
        deletedMessageIds: uniqueDeletedIds,
        previousCursor: lastHistoryId || null,
        nextCursor: newHistoryId,
        labelId: undefined, // Gmail uses integration-level cursor
      },
    ]
  }

  async importMessages(externalIds: string[]): Promise<{ imported: number; failed: number }> {
    await this.ensureInitialized()

    const accessToken = await this.getAccessToken()

    const { parsed, raw, failedMessageIds } = await getMessagesBatch({
      messageIds: externalIds,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
      accessToken,
    })

    if (failedMessageIds.length > 0) {
      logger.warn('Some message IDs failed to fetch during import', {
        integrationId: this.integrationId,
        failedFetchCount: failedMessageIds.length,
        failedFetchIds: failedMessageIds.slice(0, 20),
      })
    }

    if (parsed.length === 0) {
      return { imported: 0, failed: externalIds.length }
    }

    const messageDataArray = convertMessagesToMessageData(
      parsed,
      raw,
      this.integrationId!,
      this.inboxId!,
      this.organizationId,
      this.userEmails
    )

    const ingestor = new GmailInboundContentIngestor(this.organizationId, this.storageService)
    const result = await ingestor.storeBatchWithIngest(messageDataArray, {
      accessToken,
      integrationId: this.integrationId!,
      throttler: this.throttler!,
    })

    logger.info('importMessages completed', {
      integrationId: this.integrationId,
      requested: externalIds.length,
      fetched: parsed.length,
      stored: result.storedCount,
      failedIngest: result.failedCount,
      retriableFailures: result.retriableFailures.length,
      failedExternalIds: result.failedExternalIds.slice(0, 20),
    })

    return {
      imported: result.storedCount,
      failed: externalIds.length - result.storedCount,
    }
  }

  // --- Simulation ---

  async simulateOperation(operation: string, targetId: string, params?: any): Promise<any> {
    logger.warn('simulateOperation is not implemented for GoogleProvider')
    return Promise.resolve({ success: false, message: 'Not implemented' })
  }
}
