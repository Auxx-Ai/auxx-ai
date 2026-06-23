// packages/lib/src/providers/facebook/facebook-oauth.ts
// Runtime/maintenance helpers for the Facebook Messenger channel. The CONNECT flow (getAuthUrl /
// handleCallback) moved onto the generic connections OAuth flow + social-provisioning-hook; this
// service now only owns runtime token reads, token-validity checks, webhook unsubscribe, and revoke.
import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { deleteChannelTokens, getChannelTokens } from '../channel-token-accessor'
import { markCredentialReauth } from '../credential-auth-state'

const logger = createScopedLogger('facebook-oauth')
const DEFAULT_API_VERSION = 'v19.0'

// Interface describing the data stored for Facebook integration authentication
export interface FacebookIntegrationMetadata {
  pageId: string
  pageName: string
  pageAccessToken?: string // Long-lived Page Access Token (now stored on the credential)
  userAccessToken?: string // Optional: Long-lived User Access Token (for potential refresh/revocation)
  userId?: string // Facebook User ID associated with the token
}

export class FacebookOAuthService {
  private static instance: FacebookOAuthService
  private clientId: string
  private clientSecret: string
  private apiVersion: string

  // Scopes needed for Messenger integration
  static scopes = [
    'pages_messaging', // Send/receive messages
    'pages_manage_metadata', // Subscribe to webhooks
    'pages_read_engagement', // Read messages/conversations
  ]

  private constructor() {
    // Resolve API version lazily here (not at module level) to avoid crashing
    // when FACEBOOK_GRAPH_API_VERSION is not linked in the SST config
    try {
      this.apiVersion =
        configService.get<string>('FACEBOOK_GRAPH_API_VERSION') || DEFAULT_API_VERSION
    } catch {
      this.apiVersion = DEFAULT_API_VERSION
    }
    this.clientId = configService.get<string>('FACEBOOK_APP_ID') || ''
    this.clientSecret = configService.get<string>('FACEBOOK_APP_SECRET') || ''

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Facebook OAuth credentials (App ID, App Secret) not properly configured')
    }
  }

  public static getInstance(): FacebookOAuthService {
    if (!FacebookOAuthService.instance) {
      FacebookOAuthService.instance = new FacebookOAuthService()
    }
    return FacebookOAuthService.instance
  }

  /**
   * Unsubscribe the page from app webhooks.
   */
  private async unsubscribePageFromApp(pageId: string, pageAccessToken: string): Promise<void> {
    const unsubscribeUrl = `https://graph.facebook.com/${this.apiVersion}/${pageId}/subscribed_apps`
    const unsubscribeParams = new URLSearchParams({ access_token: pageAccessToken })

    try {
      const response = await fetch(`${unsubscribeUrl}?${unsubscribeParams.toString()}`, {
        method: 'DELETE',
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        logger.error(`Failed to unsubscribe Page ${pageId} from app webhooks`, {
          status: response.status,
          data,
        })
      } else {
        logger.info(`Successfully unsubscribed Page ${pageId} from app webhooks.`)
      }
    } catch (error) {
      logger.error(`Error unsubscribing page ${pageId} from webhooks`, { error })
    }
  }

  /**
   * Refreshes tokens - Not directly applicable to long-lived FB tokens.
   * This might re-validate the token or regenerate if needed (complex).
   * For now, it can check the token validity.
   */
  public async refreshTokens(integrationId: string): Promise<any> {
    logger.info(
      `'refreshTokens' called for Facebook integration ${integrationId}. Checking token validity.`
    )

    const tokens = await getChannelTokens(integrationId)
    if (!tokens.accessToken) {
      throw new Error('Integration or access token not found for refresh check.')
    }
    const pageAccessToken = tokens.accessToken

    try {
      const debugUrl = `https://graph.facebook.com/${this.apiVersion}/debug_token`
      const debugParams = new URLSearchParams({
        input_token: pageAccessToken,
        access_token: `${this.clientId}|${this.clientSecret}`,
      })

      const debugRes = await fetch(`${debugUrl}?${debugParams.toString()}`)
      const debugData = await debugRes.json()

      if (!debugRes.ok || debugData.error || !debugData.data?.is_valid) {
        logger.warn(
          `Facebook Page Access Token for integration ${integrationId} is invalid or expired.`,
          { debugData }
        )
        await db
          .update(schema.Integration)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(schema.Integration.id, integrationId))
        await markCredentialReauth(integrationId, 'Page access token is invalid or expired', true)
        throw new Error('Facebook token is invalid. Re-authentication required.')
      }

      if (debugData.data.expires_at && debugData.data.expires_at !== 0) {
        const expiryDate = new Date(debugData.data.expires_at * 1000)
        logger.info(
          `Facebook token for ${integrationId} is valid. Expires: ${expiryDate.toISOString()}`
        )
      } else {
        logger.info(
          `Facebook token for ${integrationId} is valid and does not expire (or expiry not provided).`
        )
      }

      const [refreshedIntegration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      return refreshedIntegration
    } catch (error: any) {
      logger.error(`Error checking Facebook token validity for integration ${integrationId}`, {
        error: error.message,
      })
      throw new Error(`Failed to validate Facebook token: ${error.message}`)
    }
  }

  /**
   * Revokes app access for the user and unsubscribes the page.
   */
  public async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      if (!integration || !integration.metadata) {
        throw new Error('Integration not found or missing metadata.')
      }

      const metadata = integration.metadata as unknown as FacebookIntegrationMetadata
      const tokens = await getChannelTokens(integrationId)
      const pageAccessToken = tokens.accessToken
      const userAccessToken = tokens.refreshToken
      const pageId = metadata.pageId
      const facebookUserId = metadata.userId

      // 1. Unsubscribe Page from App Webhooks
      if (pageId && pageAccessToken) {
        await this.unsubscribePageFromApp(pageId, pageAccessToken)
      } else {
        logger.warn('Missing Page ID or Page Access Token, cannot unsubscribe webhooks.', {
          integrationId,
        })
      }

      // 2. Revoke App Permissions for the User
      if (facebookUserId && userAccessToken && userAccessToken !== 'N/A') {
        const revokeUrl = `https://graph.facebook.com/${this.apiVersion}/${facebookUserId}/permissions`
        const revokeParams = new URLSearchParams({ access_token: userAccessToken })
        try {
          const revokeRes = await fetch(`${revokeUrl}?${revokeParams.toString()}`, {
            method: 'DELETE',
          })
          const revokeData = await revokeRes.json()
          if (!revokeRes.ok || !revokeData.success) {
            logger.error(`Failed to revoke Facebook app permissions for user ${facebookUserId}`, {
              status: revokeRes.status,
              data: revokeData,
            })
          } else {
            logger.info(`Successfully revoked Facebook app permissions for user ${facebookUserId}.`)
          }
        } catch (error) {
          logger.error(`Error revoking Facebook app permissions for user ${facebookUserId}`, {
            error,
          })
        }
      } else {
        logger.warn(
          'Missing Facebook User ID or User Access Token, cannot revoke app permissions.',
          { integrationId }
        )
      }

      // 3. Delete encrypted credentials and disable integration
      await deleteChannelTokens(integrationId)
      await db
        .update(schema.Integration)
        .set({
          enabled: false,
          metadata: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))
      logger.info(`Cleared tokens and disabled Facebook integration ${integrationId} in DB.`)

      return true
    } catch (error: any) {
      logger.error('Error revoking Facebook access:', { error: error.message, integrationId })
      throw new Error(`Failed to revoke Facebook access: ${error.message}`)
    }
  }

  /**
   * Returns the Page Access Token needed for API calls.
   */
  public async getPageAccessToken(integrationId: string): Promise<string | null> {
    const [integration] = await db
      .select({ enabled: schema.Integration.enabled })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!integration?.enabled) {
      logger.warn('Could not retrieve valid Page Access Token.', {
        integrationId,
        enabled: integration?.enabled,
      })
      return null
    }

    const tokens = await getChannelTokens(integrationId)
    return tokens.accessToken
  }

  /**
   * Helper to get Page ID from stored metadata.
   */
  public async getPageId(integrationId: string): Promise<string | null> {
    const [integration] = await db
      .select({
        metadata: schema.Integration.metadata,
      })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    if (integration?.metadata) {
      const metadata = integration.metadata as unknown as Partial<FacebookIntegrationMetadata>
      return metadata.pageId ?? null
    }
    return null
  }
}
