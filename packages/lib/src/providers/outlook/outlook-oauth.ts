// src/lib/providers/outlook/outlook-oauth.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import type { IntegrationEntity } from '@auxx/database/models'
import { InboxService } from '@auxx/lib/inboxes'
import { createScopedLogger } from '@auxx/logger'
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node'
import { Client } from '@microsoft/microsoft-graph-client'
import { eq } from 'drizzle-orm'
import { IntegrationTokenAccessor } from '../integration-token-accessor'
import { parseMsalError } from './outlook-errors'

const logger = createScopedLogger('outlook-oauth')

/** Data stored in Integration.metadata for Outlook */
export interface OutlookIntegrationMetadata {
  email: string
  homeAccountId: string
  emailAliases?: string[]
}

/** Context needed to create an authenticated Graph client */
export interface OutlookClientContext {
  integrationId: string
  refreshToken: string
  accessToken?: string | null
  expiresAt?: Date | null
  homeAccountId?: string
  email?: string
}
export class OutlookOAuthService {
  private static instance: OutlookOAuthService | null = null
  private clientId: string
  private clientSecret: string
  private redirectUri: string
  private msalClient: ConfidentialClientApplication
  private initialized: boolean = false
  static scopes = [
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/Mail.Send',
    'offline_access', // For refresh tokens
    'User.Read', // To get user profile (email)
  ]
  private constructor() {
    this.clientId = configService.get<string>('OUTLOOK_CLIENT_ID') || ''
    this.clientSecret = configService.get<string>('OUTLOOK_CLIENT_SECRET') || ''
    this.redirectUri = `${WEBAPP_URL}/api/outlook/oauth2/callback`
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error('Outlook OAuth credentials not properly configured')
    }
    if (
      configService.get<string>('NODE_ENV') === 'production' &&
      !this.redirectUri.startsWith('https')
    ) {
      logger.error('Outlook OAuth redirect URI MUST be HTTPS in production.')
    }
    const msalConfig = {
      auth: {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        authority: 'https://login.microsoftonline.com/common',
      },
      system: {
        // Increase the offset to handle potential time differences
        // This triggers token renewal 10 minutes before expiration instead of the default 5
        tokenRenewalOffsetSeconds: 600,
        // Add logging level if needed for debugging
        loggerOptions: {
          logLevel:
            configService.get<string>('NODE_ENV') === 'development'
              ? LogLevel.Verbose
              : LogLevel.Error,
          piiLoggingEnabled: false,
        },
      },
    }
    this.msalClient = new ConfidentialClientApplication(msalConfig)
    this.initialized = true
  }
  public static getInstance(): OutlookOAuthService {
    if (!OutlookOAuthService.instance) {
      OutlookOAuthService.instance = new OutlookOAuthService()
    }
    return OutlookOAuthService.instance
  }
  /**
   * Generates the OAuth authorization URL
   * Enhanced to support both initial authentication and re-authentication flows.
   */
  public async getAuthUrl(
    organizationId: string,
    userId: string,
    options: {
      redirectPath?: string
      integrationId?: string // For re-auth context
      isReauth?: boolean // Force consent for re-auth
      type?: 'initial' | 'reauth' // Auth type for callback handling
    } = {}
  ): Promise<string> {
    const stateWithContext = {
      orgId: organizationId,
      userId: userId,
      timestamp: Date.now(),
      redirectPath: options.redirectPath,
      // Add re-auth specific context
      ...(options.integrationId && { integrationId: options.integrationId }),
      ...(options.isReauth && { type: 'reauth' }),
      ...(options.type && { type: options.type }),
    }
    const authCodeUrlParameters = {
      scopes: OutlookOAuthService.scopes,
      redirectUri: this.redirectUri,
      state: JSON.stringify(stateWithContext),
      prompt: 'consent', // Always force consent to ensure refresh token
    }
    logger.info('Generated Outlook OAuth URL', {
      organizationId,
      userId,
      isReauth: options.isReauth,
      integrationId: options.integrationId,
    })
    return this.msalClient.getAuthCodeUrl(authCodeUrlParameters)
  }
  /** Handles the OAuth callback from Microsoft */
  public async handleCallback(
    code: string,
    stateString: string
  ): Promise<{
    success: boolean
    integration: IntegrationEntity
  }> {
    let state: Record<string, unknown>
    try {
      state = JSON.parse(stateString) // Should contain orgId, userId
    } catch (e: unknown) {
      logger.error('Invalid state parameter in Outlook callback:', { stateString, error: e })
      throw new Error('Invalid state parameter.')
    }
    const { orgId, userId, type, integrationId } = state
    if (!orgId || !userId) {
      throw new Error('Missing organization or user ID in state.')
    }
    const isReauth = type === 'reauth'
    logger.info('Handling Outlook OAuth callback', { orgId, userId, isReauth, integrationId })
    try {
      // 1. Exchange authorization code for tokens
      const tokenRequest = {
        code: code,
        scopes: OutlookOAuthService.scopes,
        redirectUri: this.redirectUri,
      }
      const response = await this.msalClient.acquireTokenByCode(tokenRequest)
      if (!response || !response.accessToken || !response.account?.homeAccountId) {
        logger.error('Failed to acquire token or essential account info missing.', { response })
        throw new Error('Outlook token acquisition failed: Missing token or account details.')
      }
      // 2. Extract Refresh Token
      const refreshToken = this.extractRefreshToken(response.account.homeAccountId)
      if (!refreshToken) {
        logger.error('Could not extract refresh token from MSAL cache after code acquisition.', {
          homeAccountId: response.account.homeAccountId,
        })
        throw new Error(
          'Refresh token not obtained from Microsoft. Ensure offline_access scope was granted.'
        )
      }
      // 3. Get User's Email via Graph API
      const graphClient = this.createTemporaryGraphClient(response.accessToken)
      const userProfile = await graphClient.api('/me').select('mail,userPrincipalName').get()
      const email = userProfile.mail || userProfile.userPrincipalName
      if (!email) {
        throw new Error('Could not retrieve email address from Microsoft Graph.')
      }
      logger.info('Successfully retrieved user email', { email })
      // 3b. Discover email aliases
      let emailAliases: string[] = []
      try {
        const aliasResponse = await graphClient.api('/me?$select=proxyAddresses').get()
        const proxyAddresses: string[] = aliasResponse.proxyAddresses ?? []
        emailAliases = proxyAddresses
          .filter((addr: string) => addr.startsWith('smtp:'))
          .map((addr: string) => addr.replace('smtp:', '').toLowerCase())
          .filter(Boolean)
        if (emailAliases.length > 0) {
          logger.info('Discovered email aliases', { email, aliasCount: emailAliases.length })
        }
      } catch (aliasError: any) {
        logger.warn('Failed to discover email aliases during callback', {
          error: aliasError.message,
        })
      }
      // 4. Prepare Metadata
      const integrationMetadata: OutlookIntegrationMetadata = {
        email: email,
        homeAccountId: response.account.homeAccountId,
        emailAliases,
      }
      const expiresOn = response.expiresOn
        ? new Date(response.expiresOn)
        : new Date(Date.now() + 3600 * 1000)
      // Handle re-authentication flow
      if (isReauth && integrationId) {
        logger.info('Processing re-authentication for existing Outlook integration', {
          integrationId,
        })

        await IntegrationTokenAccessor.setTokens(
          integrationId as string,
          {
            refreshToken: refreshToken,
            accessToken: response.accessToken,
            expiresAt: expiresOn,
          },
          { createdById: userId as string }
        )

        const [integration] = await db
          .update(schema.Integration)
          .set({
            email: email,
            metadata: integrationMetadata as any,
            enabled: true,
            authStatus: 'AUTHENTICATED',
            lastAuthError: null,
            lastAuthErrorAt: null,
            requiresReauth: false,
            lastSuccessfulSync: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, integrationId as string))
          .returning()

        logger.info('Re-authentication successful for Outlook integration', {
          integrationId,
          email,
        })
        return { success: true, integration, isReauth: true }
      }

      // 5. Store or Update Integration in DB (initial authentication flow)
      const existingIntegrations = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, orgId as string))
      const existingIntegration = existingIntegrations.find(
        (i) => i.provider === 'outlook' && (i.metadata as any)?.email === email
      )

      let integration: IntegrationEntity
      if (existingIntegration) {
        const [updated] = await db
          .update(schema.Integration)
          .set({
            metadata: integrationMetadata as any,
            enabled: true,
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, existingIntegration.id))
          .returning()
        integration = updated

        await IntegrationTokenAccessor.setTokens(
          existingIntegration.id,
          {
            refreshToken: refreshToken,
            accessToken: response.accessToken,
            expiresAt: expiresOn,
          },
          { createdById: userId as string }
        )
      } else {
        const [created] = await db
          .insert(schema.Integration)
          .values({
            organizationId: orgId as string,
            provider: 'outlook',
            metadata: integrationMetadata as any,
            enabled: true,
            updatedAt: new Date(),
          })
          .returning()
        integration = created

        await IntegrationTokenAccessor.setTokens(
          integration.id,
          {
            refreshToken: refreshToken,
            accessToken: response.accessToken,
            expiresAt: expiresOn,
          },
          { createdById: userId as string }
        )
      }

      const inboxService = new InboxService(db, orgId as string, userId as string)
      await inboxService.addIntegrationToDefaultInbox(integration.id)

      // Kick off polling pipeline if effective mode is polling
      try {
        const { resolveEffectiveSyncMode } = await import('../sync-mode-resolver')
        const effectiveMode = resolveEffectiveSyncMode({
          syncMode: integration.syncMode ?? 'auto',
          provider: 'outlook',
        })

        if (effectiveMode === 'polling') {
          const { getQueue } = await import('@auxx/lib/queues')
          const { Queues } = await import('@auxx/lib/jobs/queues/types')

          await db
            .update(schema.Integration)
            .set({ syncStage: 'MESSAGE_LIST_FETCH_PENDING', updatedAt: new Date() })
            .where(eq(schema.Integration.id, integration.id))

          const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)
          await pollingSyncQueue.add(
            'messageListFetchJob',
            {
              integrationId: integration.id,
              organizationId: orgId as string,
              provider: 'outlook',
            },
            { jobId: `poll-list-fetch-${integration.id}` }
          )

          logger.info('Kicked off polling pipeline for new Outlook integration', {
            integrationId: integration.id,
          })
        }
      } catch (pollingError) {
        logger.warn('Failed to kick off polling pipeline', {
          integrationId: integration.id,
          error: (pollingError as Error).message,
        })
      }

      logger.info('Outlook integration created/updated successfully', {
        integrationId: integration.id,
        email,
      })
      return { success: true, integration }
    } catch (error: unknown) {
      const err = error as {
        message?: string
        errorCode?: string
        errorMessage?: string
        stack?: string
      }
      logger.error('Error handling Outlook OAuth callback:', {
        error: err.message,
        errorCode: err.errorCode,
        errorMessage: err.errorMessage,
        stack: err.stack,
      })
      throw new Error(`Outlook OAuth callback failed: ${err.message || err.errorCode}`)
    }
  }
  /** Extract refresh token from cache by homeAccountId (used during OAuth callback) */
  private extractRefreshToken(homeAccountId: string): string | undefined {
    try {
      const tokenCache = this.msalClient.getTokenCache().serialize()
      const parsedCache = JSON.parse(tokenCache)
      if (parsedCache.RefreshToken) {
        const keys = Object.keys(parsedCache.RefreshToken)
        for (const key of keys) {
          if (key.includes(homeAccountId) && parsedCache.RefreshToken[key].secret) {
            return parsedCache.RefreshToken[key].secret
          }
        }
      }
      logger.warn('No refresh token found in MSAL cache', { homeAccountId })
      return undefined
    } catch (e) {
      logger.error('Failed to parse MSAL cache for refresh token', { error: e })
      return undefined
    }
  }
  /** Extract the most recent refresh token from the MSAL cache (used after acquireTokenByRefreshToken) */
  private extractRefreshTokenFromCache(): string | undefined {
    try {
      const tokenCache = JSON.parse(this.msalClient.getTokenCache().serialize())
      const refreshTokens = tokenCache.RefreshToken
      if (!refreshTokens) return undefined
      const firstKey = Object.keys(refreshTokens)[0]
      return firstKey ? refreshTokens[firstKey].secret : undefined
    } catch (e) {
      logger.error('Failed to extract refresh token from MSAL cache', { error: e })
      return undefined
    }
  }
  /** Helper to create a temporary Graph client with a specific token */
  private createTemporaryGraphClient(accessToken: string): Client {
    return Client.init({
      authProvider: (done) => {
        done(null, accessToken)
      },
    })
  }
  /** Refreshes the access token using acquireTokenByRefreshToken (no cache injection needed) */
  public async refreshTokens(integrationId: string): Promise<IntegrationEntity> {
    try {
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      if (!integration) {
        throw new Error('Integration not found')
      }

      const tokens = await IntegrationTokenAccessor.getTokens(integrationId)
      if (!tokens.refreshToken) {
        throw new Error('Integration missing refresh token')
      }

      logger.debug('Attempting token refresh via acquireTokenByRefreshToken', { integrationId })

      const response = await this.msalClient.acquireTokenByRefreshToken({
        refreshToken: tokens.refreshToken,
        scopes: OutlookOAuthService.scopes,
        forceCache: true,
      })

      if (!response || !response.accessToken) {
        throw new Error('Token refresh failed to return an access token')
      }

      logger.info('Outlook token refreshed successfully', { integrationId })
      const expiresOn = response.expiresOn
        ? new Date(response.expiresOn)
        : new Date(Date.now() + 3600 * 1000)

      const newRefreshToken = this.extractRefreshTokenFromCache()

      const tokenUpdate: Parameters<typeof IntegrationTokenAccessor.setTokens>[1] = {
        accessToken: response.accessToken,
        expiresAt: expiresOn,
      }
      if (newRefreshToken && newRefreshToken !== tokens.refreshToken) {
        tokenUpdate.refreshToken = newRefreshToken
      }

      await IntegrationTokenAccessor.setTokens(integrationId, tokenUpdate)

      const [updatedIntegration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      return updatedIntegration
    } catch (error) {
      const parsed = parseMsalError(error)

      logger.error('Error refreshing Outlook access token:', {
        error: parsed.message,
        code: parsed.code,
        integrationId,
      })

      if (parsed.code === 'INVALID_REFRESH_TOKEN') {
        logger.warn('Outlook refresh token is invalid or revoked. Disabling integration.', {
          integrationId,
        })
        await db
          .update(schema.Integration)
          .set({
            enabled: false,
            requiresReauth: true,
            lastAuthError: parsed.message,
            lastAuthErrorAt: new Date(),
            authStatus: 'INVALID_GRANT',
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, integrationId))
          .catch((dbErr: unknown) =>
            logger.error('Failed to disable integration after invalid grant', { dbErr })
          )
      }

      throw parsed
    }
  }
  /** Revokes access (clears encrypted tokens and disables). */
  public async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      logger.warn('Attempting to revoke Outlook access (clearing tokens & disabling)', {
        integrationId,
      })

      await IntegrationTokenAccessor.deleteTokens(integrationId)

      await db
        .update(schema.Integration)
        .set({
          enabled: false,
          metadata: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))

      logger.info(
        `Cleared tokens/metadata and disabled Outlook integration ${integrationId} in DB.`
      )
      return true
    } catch (error: unknown) {
      const err = error as { message?: string }
      logger.error('Error revoking Outlook access:', { error: err.message, integrationId })
      throw new Error(`Failed to revoke Outlook access: ${err.message}`)
    }
  }
  public getAuthenticatedClient(ctx: OutlookClientContext): Client {
    if (!ctx.integrationId || !ctx.refreshToken) {
      throw new Error('Cannot create authenticated client: Missing integrationId or refreshToken.')
    }

    const { integrationId, refreshToken } = ctx
    let currentAccessToken = ctx.accessToken || ''
    let currentExpiresAt = ctx.expiresAt

    const client = Client.init({
      authProvider: async (done) => {
        try {
          // If token is still valid (>10 min remaining), reuse it
          const isExpiringSoon =
            !currentExpiresAt || currentExpiresAt.getTime() - Date.now() < 10 * 60 * 1000

          if (currentAccessToken && !isExpiringSoon) {
            done(null, currentAccessToken)
            return
          }

          // Refresh via acquireTokenByRefreshToken
          const response = await this.msalClient.acquireTokenByRefreshToken({
            refreshToken,
            scopes: OutlookOAuthService.scopes,
            forceCache: true,
          })

          if (!response || !response.accessToken) {
            throw new Error('Token refresh failed to return an access token.')
          }

          currentAccessToken = response.accessToken
          currentExpiresAt = response.expiresOn
            ? new Date(response.expiresOn)
            : new Date(Date.now() + 3600 * 1000)

          // Update encrypted tokens in background
          const newRefreshToken = this.extractRefreshTokenFromCache()
          const tokenUpdate: Parameters<typeof IntegrationTokenAccessor.setTokens>[1] = {
            accessToken: response.accessToken,
            expiresAt: currentExpiresAt,
          }
          if (newRefreshToken && newRefreshToken !== refreshToken) {
            tokenUpdate.refreshToken = newRefreshToken
          }
          IntegrationTokenAccessor.setTokens(integrationId, tokenUpdate).catch((err: unknown) =>
            logger.error('Background token update failed in authProvider', { err })
          )

          done(null, response.accessToken)
        } catch (error) {
          const parsed = parseMsalError(error)
          logger.error('Error refreshing token in Graph authProvider:', {
            error: parsed.message,
            code: parsed.code,
            integrationId,
          })

          if (parsed.code === 'INVALID_REFRESH_TOKEN') {
            logger.warn('Refresh token invalid. Disabling integration.', { integrationId })
            db.update(schema.Integration)
              .set({
                enabled: false,
                requiresReauth: true,
                lastAuthError: parsed.message,
                lastAuthErrorAt: new Date(),
                authStatus: 'INVALID_GRANT',
                updatedAt: new Date(),
              })
              .where(eq(schema.Integration.id, integrationId))
              .catch((dbErr: unknown) =>
                logger.error('Failed to disable integration after invalid grant', { dbErr })
              )
          }

          done(parsed, null)
        }
      },
    })
    return client
  }
  /** Returns the configured MSAL client instance */
  public getMSALClient(): ConfidentialClientApplication {
    return this.msalClient
  }
}
