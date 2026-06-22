// packages/lib/src/providers/google/google-oauth.ts
//
// Google channel runtime auth helpers. The OAuth *connect* flow (auth URL, callback,
// initial/reauth/calendar provisioning) and standalone token refresh have moved to the
// unified connections layer (generic authorize/callback + post-connect provisioning hook +
// resolver-based refresh). What remains here is what the runtime providers still need:
// building an authenticated googleapis client from resolver-served tokens, arming/disarming
// the Gmail watch, and revoking access on disconnect.

import { WEBAPP_URL } from '@auxx/config/server'
import { ConfigStorage, configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type Common, google } from 'googleapis'
import {
  type ChannelTokens,
  deleteChannelTokens,
  getChannelAccessToken,
  getChannelTokens,
} from '../channel-token-accessor'
import { PROVIDER_CREDENTIAL_CONFIG } from '../provider-credentials-config'

type GaxiosError = Common.GaxiosError

const logger = createScopedLogger('google-oauth')

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

    const tokens = await getChannelTokens(integrationId)
    if (!tokens.refreshToken) throw new Error('Missing refresh token')

    // Access token served fresh by the connection layer (§4); refresh token kept as fallback.
    const freshAccessToken = await getChannelAccessToken(integrationId)
    return GoogleOAuthService.getAuthenticatedClientForOrg(integration.organizationId, {
      ...tokens,
      accessToken: freshAccessToken ?? tokens.accessToken,
    })
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

    const tokens = await getChannelTokens(integration.id)
    if (!tokens.refreshToken) {
      throw new Error('No active Google integration found for this organization')
    }
    const freshAccessToken = await getChannelAccessToken(integration.id)
    const { client } = await GoogleOAuthService.getAuthenticatedClientForOrg(organizationId, {
      ...tokens,
      accessToken: freshAccessToken ?? tokens.accessToken,
    })
    return client
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

      const tokens = await getChannelTokens(integrationId)

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
      await deleteChannelTokens(integrationId)
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
  public static async setupPushNotifications(integrationId: string): Promise<void> {
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
  public static async disablePushNotifications(
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
