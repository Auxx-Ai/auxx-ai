// packages/lib/src/providers/instagram/instagram-oauth.ts
// Runtime/maintenance helpers for the Instagram (via Facebook Page) messaging channel. The CONNECT
// flow (getAuthUrl / handleCallback) moved onto the generic connections OAuth flow +
// social-provisioning-hook; this service now only owns runtime token reads, token-validity checks,
// webhook unsubscribe, and revoke.
import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { deleteChannelTokens, getChannelTokens } from '../channel-token-accessor'
import { markCredentialReauth } from '../credential-auth-state'

const logger = createScopedLogger('instagram-oauth')
const DEFAULT_API_VERSION = 'v26.0'

// Interface describing the data stored for Instagram integration authentication
// Managed via a Facebook Page
export interface InstagramIntegrationMetadata {
  pageId: string // ID of the linked Facebook Page
  pageName: string // Name of the linked Facebook Page
  pageAccessToken?: string // Long-lived Page Access Token (now stored on the credential)
  instagramBusinessAccountId: string // The Instagram Business Account ID (IGBID)
  instagramUsername: string // Instagram username
  userAccessToken?: string // Optional: Long-lived User Access Token
  userId?: string // Facebook User ID associated with the token
}

export class InstagramOAuthService {
  private static instance: InstagramOAuthService
  private clientId: string
  private clientSecret: string
  private apiVersion: string

  // Scopes needed for Instagram Messaging via Facebook Page
  static scopes = [
    'instagram_basic', // Read IG user profile/media
    'instagram_manage_messages', // Send/receive IG messages
    'pages_messaging', // Needed for Messenger Platform features used by IG Messaging
    'pages_manage_metadata', // Subscribe page to webhooks
    'pages_read_engagement', // Read page/IG conversations
  ]

  private constructor() {
    try {
      this.apiVersion =
        configService.get<string>('FACEBOOK_GRAPH_API_VERSION') || DEFAULT_API_VERSION
    } catch {
      this.apiVersion = DEFAULT_API_VERSION
    }
    this.clientId = configService.get<string>('FACEBOOK_APP_ID') || ''
    this.clientSecret = configService.get<string>('FACEBOOK_APP_SECRET') || ''

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'Facebook/Instagram OAuth credentials (App ID, App Secret) not properly configured'
      )
    }
  }

  public static getInstance(): InstagramOAuthService {
    if (!InstagramOAuthService.instance) {
      InstagramOAuthService.instance = new InstagramOAuthService()
    }
    return InstagramOAuthService.instance
  }

  /** Unsubscribe Page from App Webhooks */
  private async unsubscribePageFromApp(pageId: string, pageAccessToken: string): Promise<void> {
    const unsubscribeUrl = `https://graph.facebook.com/${this.apiVersion}/${pageId}/subscribed_apps`
    const unsubscribeParams = new URLSearchParams({ access_token: pageAccessToken })
    logger.info(`Unsubscribing page ${pageId} from webhook fields.`)
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

  /** Revoke app permissions */
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

      const metadata = integration.metadata as unknown as InstagramIntegrationMetadata
      const tokens = await getChannelTokens(integrationId)
      const pageAccessToken = tokens.accessToken
      const userAccessToken = tokens.refreshToken
      const pageId = metadata.pageId
      const facebookUserId = metadata.userId

      if (pageId && pageAccessToken) {
        await this.unsubscribePageFromApp(pageId, pageAccessToken)
      } else {
        logger.warn('Missing Page ID or PAT, cannot unsubscribe webhooks.', { integrationId })
      }

      if (facebookUserId && userAccessToken && userAccessToken !== 'N/A') {
        const revokeUrl = `https://graph.facebook.com/${this.apiVersion}/${facebookUserId}/permissions`
        const revokeParams = new URLSearchParams({ access_token: userAccessToken })
        try {
          const revokeRes = await fetch(`${revokeUrl}?${revokeParams.toString()}`, {
            method: 'DELETE',
          })
          const revokeData = await revokeRes.json()
          if (!revokeRes.ok || !revokeData.success) {
            logger.error(`Failed to revoke Instagram app permissions for user ${facebookUserId}`, {
              status: revokeRes.status,
              data: revokeData,
            })
          } else {
            logger.info(
              `Successfully revoked Instagram app permissions for user ${facebookUserId}.`
            )
          }
        } catch (error) {
          logger.error(`Error revoking Instagram app permissions for user ${facebookUserId}`, {
            error,
          })
        }
      } else {
        logger.warn('Missing FB User ID or UAT, cannot revoke app permissions.', { integrationId })
      }

      await deleteChannelTokens(integrationId)
      await db
        .update(schema.Integration)
        .set({
          enabled: false,
          metadata: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))
      logger.info(`Cleared tokens and disabled Instagram integration ${integrationId} in DB.`)
      return true
    } catch (error: any) {
      logger.error('Error revoking Instagram access:', { error: error.message, integrationId })
      throw new Error(`Failed to revoke Instagram access: ${error.message}`)
    }
  }

  /** Check token validity (similar to FacebookOAuthService) */
  public async refreshTokens(integrationId: string): Promise<any> {
    logger.info(
      `'refreshTokens' called for Instagram integration ${integrationId}. Checking token validity.`
    )

    const tokens = await getChannelTokens(integrationId)
    if (!tokens.accessToken) {
      throw new Error('Integration or Page Access Token not found for validity check.')
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
          `Instagram (Page) Access Token for integration ${integrationId} is invalid or expired.`,
          { debugData }
        )
        await db
          .update(schema.Integration)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(schema.Integration.id, integrationId))
        await markCredentialReauth(integrationId, 'Page access token is invalid or expired', true)
        throw new Error('Instagram token is invalid. Re-authentication required.')
      }

      logger.info(`Instagram token for ${integrationId} is valid.`)
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      return integration
    } catch (error: any) {
      logger.error(`Error checking Instagram token validity for integration ${integrationId}`, {
        error: error.message,
      })
      throw new Error(`Failed to validate Instagram token: ${error.message}`)
    }
  }

  /** Get the Page Access Token */
  public async getPageAccessToken(integrationId: string): Promise<string | null> {
    const [integration] = await db
      .select({ enabled: schema.Integration.enabled })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!integration?.enabled) {
      return null
    }

    const tokens = await getChannelTokens(integrationId)
    return tokens.accessToken
  }

  /** Get the Instagram Business Account ID */
  public async getInstagramAccountId(integrationId: string): Promise<string | null> {
    const [integration] = await db
      .select({
        metadata: schema.Integration.metadata,
      })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    if (integration?.metadata) {
      const metadata = integration.metadata as unknown as Partial<InstagramIntegrationMetadata>
      return metadata.instagramBusinessAccountId ?? null
    }
    return null
  }

  /** Get the linked Facebook Page ID */
  public async getPageId(integrationId: string): Promise<string | null> {
    const [integration] = await db
      .select({
        metadata: schema.Integration.metadata,
      })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    if (integration?.metadata) {
      const metadata = integration.metadata as unknown as Partial<InstagramIntegrationMetadata>
      return metadata.pageId ?? null
    }
    return null
  }
}
