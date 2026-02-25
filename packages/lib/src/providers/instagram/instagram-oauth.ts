// src/lib/providers/instagram/instagram-oauth.ts
import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, eq } from 'drizzle-orm'
import { InboxService } from '../../inboxes/inbox-service'
import { IntegrationTokenAccessor } from '../integration-token-accessor'

const logger = createScopedLogger('instagram-oauth')
const API_VERSION = configService.get<string>('FACEBOOK_GRAPH_API_VERSION') || 'v19.0' // Use a recent, stable version

// Interface describing the data stored for Instagram integration authentication
// Managed via a Facebook Page
export interface InstagramIntegrationMetadata {
  pageId: string // ID of the linked Facebook Page
  pageName: string // Name of the linked Facebook Page
  pageAccessToken: string // Long-lived Page Access Token (used for most API calls)
  instagramBusinessAccountId: string // The Instagram Business Account ID (IGBID)
  instagramUsername: string // Instagram username
  userAccessToken?: string // Optional: Long-lived User Access Token
  userId?: string // Facebook User ID associated with the token
}

export class InstagramOAuthService {
  private static instance: InstagramOAuthService
  private clientId: string
  private clientSecret: string
  private redirectUri: string

  // Scopes needed for Instagram Messaging via Facebook Page
  static scopes = [
    'instagram_basic', // Read IG user profile/media
    'instagram_manage_messages', // Send/receive IG messages
    'pages_messaging', // Needed for Messenger Platform features used by IG Messaging
    'pages_manage_metadata', // Subscribe page to webhooks
    'pages_read_engagement', // Read page/IG conversations
    // 'manage_pages' deprecated, use granular instead
  ]

  private constructor() {
    this.clientId = configService.get<string>('FACEBOOK_APP_ID') || ''
    this.clientSecret = configService.get<string>('FACEBOOK_APP_SECRET') || ''
    // Define the callback route for Instagram via Facebook Login
    this.redirectUri = `${WEBAPP_URL}/api/instagram/oauth2/callback` // Specific callback

    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'Facebook/Instagram OAuth credentials (App ID, App Secret) not properly configured'
      )
    }
    if (
      configService.get<string>('NODE_ENV') === 'production' &&
      !this.redirectUri.startsWith('https')
    ) {
      logger.error('Instagram OAuth redirect URI MUST be HTTPS in production.')
      // Consider throwing an error in production if not HTTPS
    }
  }

  public static getInstance(): InstagramOAuthService {
    if (!InstagramOAuthService.instance) {
      InstagramOAuthService.instance = new InstagramOAuthService()
    }
    return InstagramOAuthService.instance
  }

  /**
   * Generates the Facebook Login URL for Instagram authorization.
   * Enhanced to support both initial authentication and re-authentication flows.
   */
  public getAuthUrl(
    organizationId: string,
    userId: string, // App's internal user ID
    options: {
      redirectPath?: string
      integrationId?: string // For re-auth context
      isReauth?: boolean // Force consent for re-auth
      type?: 'initial' | 'reauth' // Auth type for callback handling
    } = {}
  ): string {
    const stateWithContext = {
      orgId: organizationId,
      userId: userId,
      timestamp: Date.now(),
      redirectPath: options.redirectPath,
      // Add re-auth specific context
      ...(options.integrationId && { integrationId: options.integrationId }),
      ...(options.isReauth && { type: 'reauth' }),
      ...(options.type && { type: options.type }),
      csrfToken: crypto.randomBytes(16).toString('hex'), // CSRF protection
    }
    const encodedState = Buffer.from(JSON.stringify(stateWithContext)).toString('base64')

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: InstagramOAuthService.scopes.join(','),
      response_type: 'code',
      state: encodedState,
    })

    const url = `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params.toString()}`

    logger.info('Generated Instagram OAuth URL', {
      organizationId,
      userId,
      isReauth: options.isReauth,
      integrationId: options.integrationId,
    })

    return url
  }

  /**
   * Handles the OAuth callback from Facebook Login for Instagram.
   */
  public async handleCallback(
    code: string,
    stateString: string
  ): Promise<{ success: boolean; integration: any }> {
    let state: any
    try {
      const decodedStateString = Buffer.from(stateString, 'base64').toString('utf-8')
      state = JSON.parse(decodedStateString)
      // TODO: Verify state.csrfToken
    } catch (e) {
      logger.error('Invalid state parameter received:', { stateString, error: e })
      throw new Error('Invalid state parameter.')
    }

    const { orgId, userId } = state
    if (!orgId || !userId) {
      throw new Error('Missing organization or user ID in state.')
    }

    try {
      // 1. Exchange code for Short-lived User Access Token (UAT)
      const shortLivedUserToken = await this.exchangeCodeForToken(code)
      logger.debug('Obtained short-lived User Access Token', { orgId })

      // 2. Exchange for Long-lived User Access Token (LL UAT)
      const longLivedUserToken = await this.exchangeShortTokenForLong(shortLivedUserToken)
      logger.debug('Obtained Long-Lived User Access Token (if successful)', { orgId })

      // 3. Get Facebook User ID
      const facebookUserId = await this.getFacebookUserId(longLivedUserToken || shortLivedUserToken)

      // 4. Get Facebook Pages the user manages
      const pages = await this.getUserPages(longLivedUserToken || shortLivedUserToken)
      if (pages.length === 0) {
        throw new Error(
          'No Facebook Pages found for this user. Ensure the user manages a Page linked to an Instagram Professional account and granted permissions.'
        )
      }

      // --- User Selection Needed ---
      // In a real app, present 'pages' list to the user to select which Page (and linked IG account) to connect.
      // For now, connect the FIRST page found that has a linked Instagram Business Account.
      let selectedPage: any = null
      let instagramAccount: { id: string; username: string } | null = null

      for (const page of pages) {
        const igInfo = await this.getInstagramAccountFromPage(page.id, page.access_token) // Use page token
        if (igInfo) {
          selectedPage = page
          instagramAccount = igInfo
          logger.info(
            `Auto-selecting Page '${page.name}' (${page.id}) linked to IG Account '${igInfo.username}' (${igInfo.id})`,
            { orgId }
          )
          break
        }
      }

      if (!selectedPage || !instagramAccount) {
        throw new Error(
          'Could not find a managed Facebook Page with a linked Instagram Professional account. Please ensure the account is linked and permissions were granted.'
        )
      }

      // 5. Exchange for Long-lived Page Access Token (LL PAT)
      const longLivedPageToken = await this.exchangeShortTokenForLong(selectedPage.access_token)
      if (!longLivedPageToken) {
        // This is critical, throw an error
        logger.error('Failed to exchange for Long-Lived Page Access Token', {
          pageId: selectedPage.id,
        })
        throw new Error(`Failed to get long-lived token for Page ${selectedPage.name}.`)
      }
      logger.debug('Obtained Long-Lived Page Access Token', { pageId: selectedPage.id, orgId })

      // 6. Prepare metadata
      const integrationMetadata: InstagramIntegrationMetadata = {
        pageId: selectedPage.id,
        pageName: selectedPage.name,
        pageAccessToken: longLivedPageToken,
        instagramBusinessAccountId: instagramAccount.id,
        instagramUsername: instagramAccount.username,
        userAccessToken: longLivedUserToken, // Store LL UAT if available
        userId: facebookUserId,
      }

      // 7. Store or update integration in the database
      // Unique identifier: provider + instagramBusinessAccountId
      const existingIntegrations = await db
        .select()
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.organizationId, orgId),
            eq(schema.Integration.provider, 'instagram')
          )
        )

      // Filter by metadata in application code since Drizzle doesn't support JSON path queries elegantly
      const existingIntegration = existingIntegrations.find((integration) => {
        const metadata = integration.metadata as any
        return metadata?.instagramBusinessAccountId === instagramAccount.id
      })

      let integration
      if (existingIntegration) {
        const [updatedIntegration] = await db
          .update(schema.Integration)
          .set({
            metadata: integrationMetadata as unknown as any,
            enabled: true,
            updatedAt: new Date(),
            expiresAt: null,
          })
          .where(eq(schema.Integration.id, existingIntegration.id))
          .returning()
        integration = updatedIntegration

        await IntegrationTokenAccessor.setTokens(
          existingIntegration.id,
          {
            refreshToken: longLivedUserToken || 'N/A',
            accessToken: longLivedPageToken,
          },
          { createdById: userId }
        )
      } else {
        const [newIntegration] = await db
          .insert(schema.Integration)
          .values({
            organizationId: orgId,
            provider: 'instagram',
            metadata: integrationMetadata as unknown as any,
            enabled: true,
            expiresAt: null,
            updatedAt: new Date(),
          })
          .returning()
        integration = newIntegration

        await IntegrationTokenAccessor.setTokens(
          integration.id,
          {
            refreshToken: longLivedUserToken || 'N/A',
            accessToken: longLivedPageToken,
          },
          { createdById: userId }
        )
      }

      const inboxService = new InboxService(db, orgId, userId)
      await inboxService.addIntegrationToDefaultInbox(integration.id)

      // 8. Subscribe Page to App Webhooks for Instagram events
      await this.subscribePageToApp(selectedPage.id, longLivedPageToken)

      return { success: true, integration }
    } catch (error: any) {
      logger.error('Error handling Instagram (via Facebook) OAuth callback:', {
        error: error.message,
        stack: error.stack,
        orgId,
      })
      // Improve error message based on common issues
      if (error.message.includes('linked')) {
        throw new Error(`Failed to connect Instagram: ${error.message}`)
      }
      throw new Error(`Instagram OAuth callback failed: ${error.message}`)
    }
  }

  // --- Helper Methods for OAuth Steps ---

  private async exchangeCodeForToken(code: string): Promise<string> {
    const url = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      client_secret: this.clientSecret,
      code: code,
    })
    const res = await fetch(`${url}?${params.toString()}`)
    const data = await res.json()
    if (!res.ok || !data.access_token) {
      throw new Error(`Failed code exchange: ${data.error?.message || 'Unknown error'}`)
    }
    return data.access_token
  }

  private async exchangeShortTokenForLong(shortToken: string): Promise<string | undefined> {
    const url = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      fb_exchange_token: shortToken,
    })
    try {
      const res = await fetch(`${url}?${params.toString()}`)
      const data = await res.json()
      if (!res.ok || !data.access_token) {
        logger.warn('Failed long-lived token exchange', { error: data.error })
        return undefined // Return undefined instead of throwing for LL UAT maybe
      }
      return data.access_token
    } catch (error) {
      logger.error('Network error during long-lived token exchange', { error })
      return undefined
    }
  }

  private async getFacebookUserId(accessToken: string): Promise<string | undefined> {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${API_VERSION}/me?fields=id&access_token=${accessToken}`
      )
      const data = await res.json()
      return data?.id
    } catch (error) {
      logger.error('Failed to fetch Facebook User ID', { error })
      return undefined
    }
  }

  private async getUserPages(
    accessToken: string
  ): Promise<Array<{ id: string; name: string; access_token: string }>> {
    try {
      // Fetch pages with their own access tokens
      const url = `https://graph.facebook.com/${API_VERSION}/me/accounts?fields=id,name,access_token&access_token=${accessToken}`
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok || !data.data) {
        logger.error("Failed to fetch user's pages", { error: data.error })
        return []
      }
      return data.data
    } catch (error) {
      logger.error("Network error fetching user's pages", { error })
      return []
    }
  }

  private async getInstagramAccountFromPage(
    pageId: string,
    pageAccessToken: string
  ): Promise<{ id: string; username: string } | null> {
    try {
      const url = `https://graph.facebook.com/${API_VERSION}/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageAccessToken}`
      const res = await fetch(url)
      const data = await res.json()
      if (res.ok && data.instagram_business_account) {
        return {
          id: data.instagram_business_account.id,
          username: data.instagram_business_account.username,
        }
      }
      if (data.error) {
        logger.debug(`Failed to get IG account for page ${pageId}`, { error: data.error?.message })
      }
      return null
    } catch (error) {
      logger.error(`Network error fetching Instagram account for Page ${pageId}`, { error })
      return null
    }
  }

  /** Subscribe Page to App Webhooks */
  private async subscribePageToApp(pageId: string, pageAccessToken: string): Promise<void> {
    const subscribeUrl = `https://graph.facebook.com/${API_VERSION}/${pageId}/subscribed_apps`
    // Subscribe specifically to fields needed for Instagram Messaging
    const subscribedFields = 'messages, messaging_postbacks' // Add others if needed, like message_reads
    const subscribeParams = new URLSearchParams({
      subscribed_fields: subscribedFields,
      access_token: pageAccessToken,
    })
    logger.info(`Subscribing page ${pageId} to webhook fields: ${subscribedFields}`)
    try {
      const response = await fetch(subscribeUrl, { method: 'POST', body: subscribeParams })
      const data = await response.json()
      if (!response.ok || !data.success) {
        logger.error(`Failed to subscribe Page ${pageId} to app webhooks for Instagram`, {
          status: response.status,
          data,
        })
        logger.warn(
          `Webhook subscription failed for page ${pageId}. Real-time Instagram messages may not work.`
        )
      } else {
        logger.info(`Successfully subscribed Page ${pageId} to app webhooks for Instagram.`)
      }
    } catch (error) {
      logger.error(`Error subscribing page ${pageId} to Instagram webhooks`, { error })
    }
  }

  /** Unsubscribe Page from App Webhooks */
  private async unsubscribePageFromApp(pageId: string, pageAccessToken: string): Promise<void> {
    const unsubscribeUrl = `https://graph.facebook.com/${API_VERSION}/${pageId}/subscribed_apps`
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
      const tokens = await IntegrationTokenAccessor.getTokens(integrationId)
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
        const revokeUrl = `https://graph.facebook.com/${API_VERSION}/${facebookUserId}/permissions`
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

      await IntegrationTokenAccessor.deleteTokens(integrationId)
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

    const tokens = await IntegrationTokenAccessor.getTokens(integrationId)
    if (!tokens.accessToken) {
      throw new Error('Integration or Page Access Token not found for validity check.')
    }
    const pageAccessToken = tokens.accessToken

    try {
      const debugUrl = `https://graph.facebook.com/${API_VERSION}/debug_token`
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
          .set({
            enabled: false,
            requiresReauth: true,
            lastAuthError: 'Page access token is invalid or expired',
            lastAuthErrorAt: new Date(),
            authStatus: 'AUTH_ERROR',
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, integrationId))
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

    const tokens = await IntegrationTokenAccessor.getTokens(integrationId)
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
