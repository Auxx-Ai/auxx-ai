// packages/lib/src/providers/outlook/outlook-oauth.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { ConfigStorage, configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import type { IntegrationEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node'
import { Client } from '@microsoft/microsoft-graph-client'
import { eq } from 'drizzle-orm'
import { InboxService } from '../../inboxes/inbox-service'
import { AuthErrorHandler } from '../auth-error-handler'
import { ChannelTokenAccessor } from '../channel-token-accessor'
import { PROVIDER_CREDENTIAL_CONFIG } from '../provider-credentials-config'
import { parseMsalError } from './outlook-errors'

const logger = createScopedLogger('outlook-oauth')

/** Data stored in Integration.metadata for Outlook */
export interface OutlookIntegrationMetadata {
  email: string
  homeAccountId: string
  emailAliases?: string[]
  isCustomCredentials?: boolean
  credentialClientId?: string
}

/** Context needed to create an authenticated Graph client */
export interface OutlookClientContext {
  integrationId: string
  organizationId: string
  refreshToken: string
  accessToken?: string | null
  expiresAt?: Date | null
  homeAccountId?: string
  email?: string
}

export class OutlookOAuthService {
  static scopes = [
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/Mail.Send',
    'offline_access',
    'User.Read',
  ]

  /**
   * Resolve OAuth credentials for a specific organization.
   */
  public static async resolveCredentials(organizationId: string): Promise<{
    clientId: string
    clientSecret: string
    redirectUri: string
    isCustom: boolean
  }> {
    const config = PROVIDER_CREDENTIAL_CONFIG.outlook
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
   * Create an MSAL ConfidentialClientApplication for a specific organization.
   * A new MSAL instance is created per call — no caching, since different orgs
   * may have different credentials.
   */
  public static async getMsalClientForOrg(organizationId: string) {
    const creds = await OutlookOAuthService.resolveCredentials(organizationId)
    if (!creds.clientId || !creds.clientSecret) {
      throw new Error('Outlook OAuth credentials not configured for this organization')
    }

    if (
      configService.get<string>('NODE_ENV') === 'production' &&
      !creds.redirectUri.startsWith('https')
    ) {
      logger.error('Outlook OAuth redirect URI MUST be HTTPS in production.')
    }

    const msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        authority: 'https://login.microsoftonline.com/common',
      },
      system: {
        tokenRenewalOffsetSeconds: 600,
        loggerOptions: {
          logLevel:
            configService.get<string>('NODE_ENV') === 'development'
              ? LogLevel.Verbose
              : LogLevel.Error,
          piiLoggingEnabled: false,
        },
      },
    })

    return {
      client: msalClient,
      redirectUri: creds.redirectUri,
      isCustom: creds.isCustom,
    }
  }

  /**
   * Generates the OAuth authorization URL.
   */
  public static async getAuthUrl(
    organizationId: string,
    userId: string,
    options: {
      redirectPath?: string
      integrationId?: string
      isReauth?: boolean
      type?: 'initial' | 'reauth'
      csrfToken?: string
    } = {}
  ): Promise<string> {
    const { client: msalClient, redirectUri } =
      await OutlookOAuthService.getMsalClientForOrg(organizationId)

    const stateWithContext = {
      orgId: organizationId,
      userId: userId,
      timestamp: Date.now(),
      redirectPath: options.redirectPath,
      ...(options.integrationId && { integrationId: options.integrationId }),
      ...(options.isReauth && { type: 'reauth' }),
      ...(options.type && { type: options.type }),
      ...(options.csrfToken && { csrfToken: options.csrfToken }),
    }

    const authCodeUrlParameters = {
      scopes: OutlookOAuthService.scopes,
      redirectUri,
      state: JSON.stringify(stateWithContext),
      prompt: 'consent',
    }

    logger.info('Generated Outlook OAuth URL', {
      organizationId,
      userId,
      isReauth: options.isReauth,
      integrationId: options.integrationId,
    })

    return msalClient.getAuthCodeUrl(authCodeUrlParameters)
  }

  /** Handles the OAuth callback from Microsoft */
  public static async handleCallback(
    code: string,
    stateString: string
  ): Promise<{
    success: boolean
    integration: IntegrationEntity
    isReauth?: boolean
  }> {
    let state: Record<string, unknown>
    try {
      state = JSON.parse(stateString)
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
      const {
        client: msalClient,
        redirectUri,
        isCustom,
      } = await OutlookOAuthService.getMsalClientForOrg(orgId as string)

      // 1. Exchange authorization code for tokens
      const tokenRequest = {
        code: code,
        scopes: OutlookOAuthService.scopes,
        redirectUri,
      }
      const response = await msalClient.acquireTokenByCode(tokenRequest)
      if (!response || !response.accessToken || !response.account?.homeAccountId) {
        logger.error('Failed to acquire token or essential account info missing.', { response })
        throw new Error('Outlook token acquisition failed: Missing token or account details.')
      }

      // 2. Extract Refresh Token
      const refreshToken = OutlookOAuthService.extractRefreshToken(
        msalClient,
        response.account.homeAccountId
      )
      if (!refreshToken) {
        logger.error('Could not extract refresh token from MSAL cache after code acquisition.', {
          homeAccountId: response.account.homeAccountId,
        })
        throw new Error(
          'Refresh token not obtained from Microsoft. Ensure offline_access scope was granted.'
        )
      }

      // 3. Get User's Email via Graph API
      const graphClient = OutlookOAuthService.createTemporaryGraphClient(response.accessToken)
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

      // Resolve the current client ID to store as credential snapshot
      const creds = await OutlookOAuthService.resolveCredentials(orgId as string)

      // 4. Prepare Metadata
      const integrationMetadata: OutlookIntegrationMetadata = {
        email: email,
        homeAccountId: response.account.homeAccountId,
        emailAliases,
        isCustomCredentials: isCustom,
        credentialClientId: creds.clientId,
      }
      const expiresOn = response.expiresOn
        ? new Date(response.expiresOn)
        : new Date(Date.now() + 3600 * 1000)

      // Handle re-authentication flow
      if (isReauth && integrationId) {
        logger.info('Processing re-authentication for existing Outlook integration', {
          integrationId,
        })

        await ChannelTokenAccessor.setTokens(
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

        await ChannelTokenAccessor.setTokens(
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

        await ChannelTokenAccessor.setTokens(
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
          const { getQueue, Queues } = await import('../../jobs/queues')

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
            {
              jobId: `poll-list-fetch-${integration.id}-${Date.now()}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 60000 },
              removeOnComplete: { count: 50 },
              removeOnFail: { count: 100 },
            }
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
  private static extractRefreshToken(
    msalClient: ConfidentialClientApplication,
    homeAccountId: string
  ): string | undefined {
    try {
      const tokenCache = msalClient.getTokenCache().serialize()
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
  private static extractRefreshTokenFromCache(
    msalClient: ConfidentialClientApplication
  ): string | undefined {
    try {
      const tokenCache = JSON.parse(msalClient.getTokenCache().serialize())
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
  private static createTemporaryGraphClient(accessToken: string): Client {
    return Client.init({
      authProvider: (done) => {
        done(null, accessToken)
      },
    })
  }

  /** Refreshes the access token using acquireTokenByRefreshToken */
  public static async refreshTokens(integrationId: string): Promise<IntegrationEntity> {
    try {
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      if (!integration) {
        throw new Error('Integration not found')
      }

      // Check for credential rotation
      const { clientId } = await OutlookOAuthService.resolveCredentials(integration.organizationId)
      const metadata = integration.metadata as any
      if (metadata?.credentialClientId && metadata.credentialClientId !== clientId) {
        await db
          .update(schema.Integration)
          .set({
            authStatus: 'AUTH_ERROR',
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
        throw new Error('Integration missing refresh token')
      }

      const { client: msalClient } = await OutlookOAuthService.getMsalClientForOrg(
        integration.organizationId
      )

      logger.debug('Attempting token refresh via acquireTokenByRefreshToken', { integrationId })

      const response = await msalClient.acquireTokenByRefreshToken({
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

      const newRefreshToken = OutlookOAuthService.extractRefreshTokenFromCache(msalClient)

      const tokenUpdate: Parameters<typeof ChannelTokenAccessor.setTokens>[1] = {
        accessToken: response.accessToken,
        expiresAt: expiresOn,
      }
      if (newRefreshToken && newRefreshToken !== tokens.refreshToken) {
        tokenUpdate.refreshToken = newRefreshToken
      }

      await ChannelTokenAccessor.setTokens(integrationId, tokenUpdate)
      await AuthErrorHandler.resetFailureCounter(integrationId)

      const [updatedIntegration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      return updatedIntegration
    } catch (error) {
      const parsed = parseMsalError(error)
      const handler = new AuthErrorHandler('outlook', integrationId)
      await handler.handleAuthError(parsed, 'token_refresh')
      throw parsed
    }
  }

  /** Revokes access (clears encrypted tokens and disables). */
  public static async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      logger.warn('Attempting to revoke Outlook access (clearing tokens & disabling)', {
        integrationId,
      })

      await ChannelTokenAccessor.deleteTokens(integrationId)

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

  /**
   * Creates an authenticated Graph client for a given context.
   * The MSAL client is created per-call to use the correct org credentials.
   */
  public static async getAuthenticatedClient(ctx: OutlookClientContext): Promise<Client> {
    if (!ctx.integrationId || !ctx.refreshToken) {
      throw new Error('Cannot create authenticated client: Missing integrationId or refreshToken.')
    }

    const { client: msalClient } = await OutlookOAuthService.getMsalClientForOrg(ctx.organizationId)
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
          const response = await msalClient.acquireTokenByRefreshToken({
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
          const newRefreshToken = OutlookOAuthService.extractRefreshTokenFromCache(msalClient)
          const tokenUpdate: Parameters<typeof ChannelTokenAccessor.setTokens>[1] = {
            accessToken: response.accessToken,
            expiresAt: currentExpiresAt,
          }
          if (newRefreshToken && newRefreshToken !== refreshToken) {
            tokenUpdate.refreshToken = newRefreshToken
          }
          ChannelTokenAccessor.setTokens(integrationId, tokenUpdate).catch((err: unknown) =>
            logger.error('Background token update failed in authProvider', { err })
          )

          done(null, response.accessToken)
        } catch (error) {
          const parsed = parseMsalError(error)
          const handler = new AuthErrorHandler('outlook', integrationId)
          // Fire-and-forget here is acceptable: the Graph authProvider callback
          // signature requires a synchronous `done()` call; the handler write
          // is best-effort and the surfaced error still triggers the caller's
          // own retry/failure path.
          handler
            .handleAuthError(parsed, 'graph_auth_provider')
            .catch((handlerErr: unknown) =>
              logger.error('AuthErrorHandler failed in Graph authProvider', { handlerErr })
            )

          done(parsed, null)
        }
      },
    })
    return client
  }
}
