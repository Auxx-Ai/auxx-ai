// packages/lib/src/providers/outlook/outlook-oauth.ts
//
// Outlook channel runtime auth helpers. The OAuth *connect* flow (auth URL, callback,
// initial/reauth provisioning) and standalone token refresh have moved to the unified
// connections layer (generic authorize/callback + post-connect provisioning hook). What
// remains here is the runtime Graph client builder used for message ops.
//
// NOTE: `getAuthenticatedClient` still refreshes via MSAL. Dropping `@azure/msal-node`
// entirely is gated on the §7 verification (raw Microsoft token POST returns a rolling
// refresh_token) — once confirmed, this can take its token from the resolver like Gmail.

import { WEBAPP_URL } from '@auxx/config/server'
import { ConfigStorage, configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node'
import { Client } from '@microsoft/microsoft-graph-client'
import { eq } from 'drizzle-orm'
import { AuthErrorHandler } from '../auth-error-handler'
import { deleteChannelTokens, setChannelTokens } from '../channel-token-accessor'
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

  /** Revokes access (clears encrypted tokens and disables). */
  public static async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      logger.warn('Attempting to revoke Outlook access (clearing tokens & disabling)', {
        integrationId,
      })

      await deleteChannelTokens(integrationId)

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
          const tokenUpdate: Parameters<typeof setChannelTokens>[1] = {
            accessToken: response.accessToken,
            expiresAt: currentExpiresAt,
          }
          if (newRefreshToken && newRefreshToken !== refreshToken) {
            tokenUpdate.refreshToken = newRefreshToken
          }
          setChannelTokens(integrationId, tokenUpdate).catch((err: unknown) =>
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
