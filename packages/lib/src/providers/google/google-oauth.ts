// packages/lib/src/providers/google/google-oauth.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { ConfigStorage, configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type Common, google } from 'googleapis'
import { InboxService } from '../../inboxes/inbox-service'
import { SettingsService } from '../../settings/settings-service'
import { AuthErrorHandler } from '../auth-error-handler'
import { ChannelTokenAccessor, type ChannelTokens } from '../channel-token-accessor'
import { PROVIDER_CREDENTIAL_CONFIG } from '../provider-credentials-config'

type GaxiosError = Common.GaxiosError

const logger = createScopedLogger('google-oauth')

const OAUTH_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.labels',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/pubsub',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
} as const

type OAuthPurpose = keyof typeof OAUTH_SCOPES

interface TokenSet {
  refreshToken: string
  accessToken: string | null
  expiresAt: Date | null
}

export class GoogleOAuthService {
  /**
   * Resolve OAuth credentials for a specific organization.
   * Checks org-level overrides first, falls back to platform credentials.
   */
  public static async resolveCredentials(organizationId: string): Promise<{
    clientId: string
    clientSecret: string
    redirectUri: string
    isCustom: boolean
  }> {
    const config = PROVIDER_CREDENTIAL_CONFIG.google
    const clientId = await configService.getForOrg<string>(organizationId, config.clientIdKey)
    const clientSecret = await configService.getForOrg<string>(
      organizationId,
      config.clientSecretKey
    )

    const orgOverrides = await new ConfigStorage().getAllForOrg(organizationId)
    const hasOrgOverride = orgOverrides.some((o) => o.key === config.clientIdKey)

    return {
      clientId: clientId || '',
      clientSecret: clientSecret || '',
      redirectUri: `${WEBAPP_URL}${config.callbackPath}`,
      isCustom: hasOrgOverride,
    }
  }

  /**
   * Create an OAuth2 client for a specific organization.
   */
  public static async getOAuthClientForOrg(organizationId: string) {
    const creds = await GoogleOAuthService.resolveCredentials(organizationId)
    if (!creds.clientId || !creds.clientSecret) {
      throw new Error('Google OAuth credentials not configured for this organization')
    }
    return {
      client: new google.auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUri),
      isCustom: creds.isCustom,
    }
  }

  /**
   * Creates an authenticated OAuth2 client using decrypted tokens for a specific org.
   */
  public static async getAuthenticatedClientForOrg(organizationId: string, tokens: ChannelTokens) {
    const { client, isCustom } = await GoogleOAuthService.getOAuthClientForOrg(organizationId)
    client.setCredentials({
      refresh_token: tokens.refreshToken || undefined,
      access_token: tokens.accessToken || undefined,
      expiry_date: tokens.expiresAt ? tokens.expiresAt.getTime() : undefined,
    })
    return { client, isCustom }
  }

  /**
   * Finds an integration by ID, resolves the org's credentials, and returns
   * an authenticated client.
   */
  public static async getClientFromIntegrationId(integrationId: string) {
    const [integration] = await db
      .select({ organizationId: schema.Integration.organizationId })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!integration) throw new Error('Integration not found')

    const tokens = await ChannelTokenAccessor.getTokens(integrationId)
    if (!tokens.refreshToken) throw new Error('Missing refresh token')

    return GoogleOAuthService.getAuthenticatedClientForOrg(integration.organizationId, tokens)
  }

  /**
   * Finds the active Google integration for an organization and returns an authenticated client.
   */
  public static async getClientForOrganization(organizationId: string) {
    const [integration] = await db
      .select({ id: schema.Integration.id })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, organizationId),
          eq(schema.Integration.enabled, true),
          eq(schema.Integration.provider, 'google')
        )
      )
      .orderBy(desc(schema.Integration.updatedAt))
      .limit(1)

    if (!integration) {
      throw new Error('No active Google integration found for this organization')
    }

    const tokens = await ChannelTokenAccessor.getTokens(integration.id)
    if (!tokens.refreshToken) {
      throw new Error('No active Google integration found for this organization')
    }
    const { client } = await GoogleOAuthService.getAuthenticatedClientForOrg(organizationId, tokens)
    return client
  }

  /**
   * Generates a Google OAuth URL for the given purpose (gmail or calendar).
   */
  public static async getAuthUrl(
    organizationId: string,
    userId: string,
    options: {
      purpose?: OAuthPurpose
      redirectPath?: string
      integrationId?: string
      isReauth?: boolean
      type?: 'initial' | 'reauth'
      csrfToken?: string
    } = {}
  ): Promise<string> {
    const purpose = options.purpose ?? 'gmail'
    const { client } = await GoogleOAuthService.getOAuthClientForOrg(organizationId)
    const stateWithContext = {
      orgId: organizationId,
      userId: userId,
      timestamp: Date.now(),
      ...(purpose !== 'gmail' && { purpose }),
      ...(options.redirectPath && { redirectPath: options.redirectPath }),
      ...(options.integrationId && { integrationId: options.integrationId }),
      ...(options.isReauth && { type: 'reauth' }),
      ...(options.type && { type: options.type }),
      ...(options.csrfToken && { csrfToken: options.csrfToken }),
    }

    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: OAUTH_SCOPES[purpose],
      state: JSON.stringify(stateWithContext),
      include_granted_scopes: true,
    })

    logger.info(`Generated Google OAuth URL (${purpose})`, {
      organizationId,
      userId,
      purpose,
      isReauth: options.isReauth,
      integrationId: options.integrationId,
    })

    return url
  }

  /**
   * Handles the OAuth callback from Google.
   */
  public static async handleCallback(
    code: string,
    stateString: string
  ): Promise<{
    success: boolean
    integration: any
    isReauth?: boolean
    isCalendarGrant?: boolean
  }> {
    try {
      let state
      try {
        state = JSON.parse(stateString)
      } catch (e) {
        logger.error('Invalid state parameter:', { error: e })
        throw new Error('Invalid state parameter')
      }

      const { orgId, userId, type, integrationId, purpose } = state
      if (!orgId || !userId) {
        throw new Error('Missing organization or user ID in state')
      }

      const isReauth = type === 'reauth'
      logger.info('Handling Google OAuth callback', {
        orgId,
        userId,
        isReauth,
        integrationId,
        purpose,
      })

      // Exchange code for tokens and resolve email
      const { client: oauth2Client, isCustom } =
        await GoogleOAuthService.getOAuthClientForOrg(orgId)
      const { tokens } = await oauth2Client.getToken(code)
      oauth2Client.setCredentials(tokens)

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
      const userInfo = await oauth2.userinfo.get()
      const email = userInfo.data.email
      if (!email) {
        throw new Error('Could not retrieve email address from Google')
      }

      // Resolve refresh token (new from Google, or existing from prior auth)
      const existingTokens = integrationId
        ? await ChannelTokenAccessor.getTokens(integrationId).catch(() => null)
        : null
      const refreshToken = tokens.refresh_token ?? existingTokens?.refreshToken ?? null
      if (!refreshToken) {
        logger.error('No refresh token available')
        throw new Error('No refresh token received from Google')
      }

      const creds = await GoogleOAuthService.resolveCredentials(orgId)
      const integrationMetadata = {
        email,
        isCustomCredentials: isCustom,
        credentialClientId: creds.clientId,
      }
      const tokenSet: TokenSet = {
        refreshToken,
        accessToken: tokens.access_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      }

      // Dispatch to the appropriate handler
      if (purpose === 'calendar' && integrationId) {
        return GoogleOAuthService.handleCalendarGrant(
          integrationId,
          userId,
          email,
          integrationMetadata,
          tokenSet
        )
      }
      if (isReauth && integrationId) {
        return GoogleOAuthService.handleReauth(
          integrationId,
          userId,
          email,
          integrationMetadata,
          tokenSet,
          isCustom
        )
      }
      return GoogleOAuthService.handleInitialAuth(
        orgId,
        userId,
        email,
        integrationMetadata,
        tokenSet,
        isCustom
      )
    } catch (error: any) {
      logger.error('Error handling Google OAuth callback:', {
        message: error.message,
        response: error.response?.data,
        stack: error.stack,
      })
      throw new Error(`Google OAuth callback failed: ${error.message}`)
    }
  }

  /**
   * Handles a calendar-only scope grant for an existing integration.
   */
  private static async handleCalendarGrant(
    integrationId: string,
    userId: string,
    email: string,
    metadata: Record<string, unknown>,
    tokenSet: TokenSet
  ) {
    const [existing] = await db
      .select({ id: schema.Integration.id, metadata: schema.Integration.metadata })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!existing) {
      throw new Error(`Integration ${integrationId} not found for calendar grant`)
    }

    await saveTokensAndUpdateIntegration(integrationId, userId, tokenSet, {
      email,
      metadata: mergeIntegrationMetadata(existing.metadata, {
        ...metadata,
        calendarSyncEnabled: true,
        calendarSyncToken: null,
      }),
      enabled: true,
      authStatus: 'AUTHENTICATED',
      lastAuthError: null,
      lastAuthErrorAt: null,
      requiresReauth: false,
    })

    const [integration] = await db
      .select()
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    // Ensure recording.enabled is set in OrganizationSetting so the
    // recording-bot scheduler can discover this org.
    const settingsService = new SettingsService()
    await settingsService.updateOrganizationSetting({
      organizationId: integration.organizationId,
      key: 'recording.enabled',
      value: true,
      allowUserOverride: false,
    })

    return { success: true as const, integration, isCalendarGrant: true }
  }

  /**
   * Handles re-authentication for an existing integration.
   */
  private static async handleReauth(
    integrationId: string,
    userId: string,
    email: string,
    metadata: Record<string, unknown>,
    tokenSet: TokenSet,
    isCustom: boolean
  ) {
    logger.info('Processing re-authentication for existing integration', { integrationId })

    const [existing] = await db
      .select({ metadata: schema.Integration.metadata })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    await saveTokensAndUpdateIntegration(integrationId, userId, tokenSet, {
      email,
      metadata: mergeIntegrationMetadata(existing?.metadata, metadata),
      enabled: true,
      authStatus: 'AUTHENTICATED',
      lastAuthError: null,
      lastAuthErrorAt: null,
      requiresReauth: false,
      lastSuccessfulSync: new Date(),
    })

    logger.info('Re-authentication successful', { integrationId, email })

    // Re-setup Gmail webhooks (may have expired)
    if (!isCustom) {
      try {
        await GoogleOAuthService.setupPushNotifications(integrationId)
      } catch (webhookError) {
        logger.warn('Failed to setup webhooks during re-auth', {
          integrationId,
          error: (webhookError as Error).message,
        })
      }
    }

    const [integration] = await db
      .select()
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    return { success: true as const, integration, isReauth: true }
  }

  /**
   * Handles first-time authentication (upserts the integration).
   */
  private static async handleInitialAuth(
    orgId: string,
    userId: string,
    email: string,
    metadata: Record<string, unknown>,
    tokenSet: TokenSet,
    isCustom: boolean
  ) {
    // Check for an existing integration with the same email
    const [existingIntegration] = await db
      .select()
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, orgId),
          eq(schema.Integration.provider, 'google'),
          eq(schema.Integration.email, email)
        )
      )
      .limit(1)

    let integration
    if (existingIntegration) {
      await saveTokensAndUpdateIntegration(existingIntegration.id, userId, tokenSet, {
        enabled: true,
        metadata: mergeIntegrationMetadata(existingIntegration.metadata, metadata),
      })
      ;[integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, existingIntegration.id))
        .limit(1)
    } else {
      ;[integration] = await db
        .insert(schema.Integration)
        .values({
          organizationId: orgId,
          provider: 'google',
          enabled: true,
          metadata,
          email,
          updatedAt: new Date(),
        })
        .returning()

      await ChannelTokenAccessor.setTokens(integration!.id, tokenSet, { createdById: userId })
    }

    const inboxService = new InboxService(db, orgId, userId)
    await inboxService.addIntegrationToDefaultInbox(integration!.id)

    // Force polling for custom credentials (PubSub won't work with custom OAuth apps)
    if (isCustom) {
      await db
        .update(schema.Integration)
        .set({ syncMode: 'polling', updatedAt: new Date() })
        .where(eq(schema.Integration.id, integration!.id))
    }

    // Set up Gmail webhooks (push notifications) or kick off polling
    const { resolveEffectiveSyncMode } = await import('../sync-mode-resolver')
    const effectiveMode = resolveEffectiveSyncMode({
      syncMode: isCustom ? 'polling' : (integration!.syncMode ?? 'auto'),
      provider: 'google',
    })

    if (effectiveMode === 'webhook') {
      await GoogleOAuthService.setupPushNotifications(integration!.id)
    } else {
      const { getQueue, Queues } = await import('../../jobs/queues')

      await db
        .update(schema.Integration)
        .set({ syncStage: 'MESSAGE_LIST_FETCH_PENDING', updatedAt: new Date() })
        .where(eq(schema.Integration.id, integration!.id))

      const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)
      await pollingSyncQueue.add(
        'messageListFetchJob',
        {
          integrationId: integration!.id,
          organizationId: orgId,
          provider: 'google',
        },
        {
          jobId: `poll-list-fetch-${integration!.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        }
      )

      logger.info('Kicked off polling pipeline for new Google integration', {
        integrationId: integration!.id,
      })
    }

    return { success: true as const, integration }
  }

  /**
   * Refreshes OAuth tokens for a Google integration.
   */
  public static async refreshTokens(integrationId: string): Promise<any> {
    try {
      // Look up the org from the integration
      const [integration] = await db
        .select({
          organizationId: schema.Integration.organizationId,
          metadata: schema.Integration.metadata,
        })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (!integration) throw new Error('Integration not found')

      // Check for credential rotation
      const { clientId } = await GoogleOAuthService.resolveCredentials(integration.organizationId)
      const metadata = integration.metadata as any
      if (metadata?.credentialClientId && metadata.credentialClientId !== clientId) {
        // Credentials were rotated — token can't be refreshed with new client
        await db
          .update(schema.Integration)
          .set({
            authStatus: 'PROVIDER_ERROR',
            requiresReauth: true,
            lastAuthError: 'OAuth credentials were changed. Please reconnect this channel.',
            lastAuthErrorAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, integrationId))
        throw new Error('OAuth credentials were rotated. Channel requires reconnection.')
      }

      const tokens = await ChannelTokenAccessor.getTokens(integrationId)
      if (!tokens.refreshToken) {
        throw new Error('Integration not found or missing refresh token')
      }

      const { client: oauth2Client } = await GoogleOAuthService.getOAuthClientForOrg(
        integration.organizationId
      )
      oauth2Client.setCredentials({ refresh_token: tokens.refreshToken })

      const { credentials } = await oauth2Client.refreshAccessToken()

      const tokenUpdate: Parameters<typeof ChannelTokenAccessor.setTokens>[1] = {
        accessToken: credentials.access_token ?? null,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      }

      // Update refresh token only if Google provides a new one
      if (credentials.refresh_token && credentials.refresh_token !== tokens.refreshToken) {
        tokenUpdate.refreshToken = credentials.refresh_token
      }

      await ChannelTokenAccessor.setTokens(integrationId, tokenUpdate)
      await AuthErrorHandler.resetFailureCounter(integrationId)

      const [updatedIntegration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      return updatedIntegration
    } catch (error: any) {
      const handler = new AuthErrorHandler('google', integrationId)
      const details = await handler.handleAuthError(error, 'token_refresh')
      throw new Error(`Failed to refresh Google access token: ${details.message}`)
    }
  }

  /**
   * Revokes access to a Google OAuth integration.
   */
  public static async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      const [integration] = await db
        .select({ organizationId: schema.Integration.organizationId })
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (!integration) throw new Error('Integration not found')

      const tokens = await ChannelTokenAccessor.getTokens(integrationId)

      // Disable inbox watching first
      if (tokens.refreshToken) {
        await GoogleOAuthService.disablePushNotifications(integrationId, tokens)
      }

      // Revoke tokens with Google's API
      const { client: oauth2Client } = await GoogleOAuthService.getOAuthClientForOrg(
        integration.organizationId
      )
      const tokensToRevoke = [tokens.accessToken, tokens.refreshToken].filter(Boolean)

      for (const token of tokensToRevoke) {
        try {
          if (token) {
            await oauth2Client.revokeToken(token)
            logger.info('Successfully revoked token for integration', { integrationId })
          }
        } catch (error: any) {
          if (error.response?.data?.error === 'invalid_token') {
            logger.info('Token already invalid/revoked during revocation attempt', {
              integrationId,
            })
          } else {
            logger.warn('Failed to revoke token with Google (continuing cleanup)', {
              error: error.message,
              integrationId,
            })
          }
        }
      }

      // Delete encrypted credentials and disable integration
      await ChannelTokenAccessor.deleteTokens(integrationId)
      await db
        .update(schema.Integration)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(schema.Integration.id, integrationId))

      return true
    } catch (error: any) {
      logger.error('Error revoking Google access:', { error: error.message, integrationId })
      throw new Error(`Failed to revoke Google access: ${error.message}`)
    }
  }

  /**
   * Sets up Gmail push notifications for a specific integration.
   */
  private static async setupPushNotifications(integrationId: string): Promise<void> {
    try {
      const { client } = await GoogleOAuthService.getClientFromIntegrationId(integrationId)
      const gmail = google.gmail({ version: 'v1', auth: client })

      const topicName = `projects/${configService.get<string>('GOOGLE_PROJECT_ID')}/topics/${configService.get<string>('GOOGLE_PUBSUB_TOPIC')}`

      await gmail.users.watch({
        userId: 'me',
        requestBody: { topicName, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' },
      })

      logger.info('Gmail push notifications (watch) set up successfully', {
        integrationId,
        topicName,
      })
    } catch (error: any) {
      const gaxiosError = error as GaxiosError
      logger.error('Error setting up Gmail push notifications:', {
        message: gaxiosError.message,
        status: gaxiosError.response?.status,
        data: gaxiosError.response?.data,
        integrationId,
      })
      throw new Error(`Failed to set up Gmail push notifications: ${gaxiosError.message}`)
    }
  }

  /**
   * Disables Gmail push notifications for a given integration.
   */
  private static async disablePushNotifications(
    integrationId: string,
    tokens?: ChannelTokens
  ): Promise<void> {
    try {
      let oauth2Client: any
      if (tokens?.refreshToken) {
        // Look up org for this integration to resolve credentials
        const [integration] = await db
          .select({ organizationId: schema.Integration.organizationId })
          .from(schema.Integration)
          .where(eq(schema.Integration.id, integrationId))
          .limit(1)

        if (integration) {
          const result = await GoogleOAuthService.getAuthenticatedClientForOrg(
            integration.organizationId,
            tokens
          )
          oauth2Client = result.client
        }
      }

      if (!oauth2Client) {
        const result = await GoogleOAuthService.getClientFromIntegrationId(integrationId)
        oauth2Client = result.client
      }

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

      await gmail.users.stop({ userId: 'me' })

      logger.info('Gmail push notifications (watch) disabled successfully', { integrationId })
    } catch (error: any) {
      const gaxiosError = error as GaxiosError
      if (gaxiosError.response?.status === 404) {
        logger.warn('No active Gmail watch found to disable.', { integrationId })
      } else if (gaxiosError.response?.data?.error === 'invalid_grant') {
        logger.warn(
          'Invalid grant while trying to disable push notifications (token likely expired/revoked).',
          { integrationId }
        )
      } else {
        logger.error('Error disabling Gmail push notifications:', {
          message: gaxiosError.message,
          status: gaxiosError.response?.status,
          data: gaxiosError.response?.data,
          integrationId,
        })
        logger.warn('Continuing cleanup despite push notification disabling error.', {
          integrationId,
        })
      }
    }
  }
}

/**
 * Saves tokens and updates an existing integration in a single sequence.
 */
async function saveTokensAndUpdateIntegration(
  integrationId: string,
  userId: string,
  tokenSet: TokenSet,
  updates: Record<string, unknown>
) {
  await ChannelTokenAccessor.setTokens(integrationId, tokenSet, { createdById: userId })
  await db
    .update(schema.Integration)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.Integration.id, integrationId))
}

/**
 * Merge provider metadata into an existing integration metadata object.
 */
function mergeIntegrationMetadata(
  existingMetadata: unknown,
  updates: Record<string, unknown>
): Record<string, unknown> {
  const base =
    existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
      ? (existingMetadata as Record<string, unknown>)
      : {}

  return {
    ...base,
    ...updates,
  }
}
