// src/lib/email/providers/facebook-oauth.ts
import { env, WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq, and } from 'drizzle-orm'
import crypto from 'crypto'
import { InboxService } from '@auxx/lib/inboxes'

const logger = createScopedLogger('facebook-oauth')
const API_VERSION = env.FACEBOOK_GRAPH_API_VERSION || 'v19.0' // Use a recent, stable version

// Interface describing the data stored for Facebook integration authentication
export interface FacebookIntegrationMetadata {
  pageId: string
  pageName: string
  pageAccessToken: string // Long-lived Page Access Token
  userAccessToken?: string // Optional: Long-lived User Access Token (for potential refresh/revocation)
  userId?: string // Facebook User ID associated with the token
}

export class FacebookOAuthService {
  private static instance: FacebookOAuthService
  private clientId: string
  private clientSecret: string
  private redirectUri: string

  // Scopes needed for Messenger integration
  static scopes = [
    'pages_messaging', // Send/receive messages
    'pages_manage_metadata', // Subscribe to webhooks
    'pages_read_engagement', // Read messages/conversations
    // 'public_profile',        // Optional: Get basic user info
    // 'email',                 // Optional: Get user email if needed during auth
  ]

  private constructor() {
    this.clientId = env.FACEBOOK_APP_ID || ''
    this.clientSecret = env.FACEBOOK_APP_SECRET || ''
    // Define the callback route for Facebook
    this.redirectUri = `${WEBAPP_URL}/api/facebook/oauth2/callback`

    if (!this.clientId || !this.clientSecret) {
      throw new Error('Facebook OAuth credentials (App ID, App Secret) not properly configured')
    }
    if (!this.redirectUri.startsWith('https')) {
      logger.warn('Facebook OAuth redirect URI is not HTTPS. This will not work in production.')
    }
  }

  public static getInstance(): FacebookOAuthService {
    if (!FacebookOAuthService.instance) {
      FacebookOAuthService.instance = new FacebookOAuthService()
    }
    return FacebookOAuthService.instance
  }

  /**
   * Generates the Facebook Login URL for authorization.
   * Enhanced to support both initial authentication and re-authentication flows.
   */
  public async getAuthUrl(
    organizationId: string,
    userId: string, // App's internal user ID
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
      // Add a CSRF token to state for security
      csrfToken: crypto.randomBytes(16).toString('hex'),
    }
    const encodedState = Buffer.from(JSON.stringify(stateWithContext)).toString('base64') // Base64 encode state

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: FacebookOAuthService.scopes.join(','),
      response_type: 'code', // Request authorization code
      state: encodedState,
    })

    const url = `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params.toString()}`

    logger.info('Generated Facebook OAuth URL', {
      organizationId,
      userId,
      isReauth: options.isReauth,
      integrationId: options.integrationId,
    })

    return url
  }

  /**
   * Handles the OAuth callback from Facebook.
   */
  public async handleCallback(
    code: string,
    stateString: string
  ): Promise<{ success: boolean; integration: any }> {
    let state: any
    try {
      // Decode state first
      const decodedStateString = Buffer.from(stateString, 'base64').toString('utf-8')
      state = JSON.parse(decodedStateString)
      // TODO: Verify state.csrfToken if stored in session/cookie during getAuthUrl
    } catch (e) {
      logger.error('Invalid or malformed state parameter received:', { stateString, error: e })
      throw new Error('Invalid state parameter.')
    }

    const { orgId, userId } = state
    if (!orgId || !userId) {
      throw new Error('Missing organization or user ID in state.')
    }

    try {
      // 1. Exchange code for a short-lived User Access Token
      const tokenUrl = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`
      const tokenParams = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        client_secret: this.clientSecret,
        code: code,
      })

      const tokenRes = await fetch(`${tokenUrl}?${tokenParams.toString()}`)
      const tokenData = await tokenRes.json()

      if (!tokenRes.ok || !tokenData.access_token) {
        logger.error('Failed to exchange code for User Access Token', { data: tokenData })
        throw new Error(
          `Facebook token exchange failed: ${tokenData.error?.message || 'Unknown error'}`
        )
      }
      const shortLivedUserToken = tokenData.access_token
      logger.debug('Obtained short-lived User Access Token', { orgId })

      // 2. Exchange short-lived User Token for a Long-Lived User Token
      const longLivedUrl = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`
      const longLivedParams = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        fb_exchange_token: shortLivedUserToken,
      })
      const longLivedRes = await fetch(`${longLivedUrl}?${longLivedParams.toString()}`)
      const longLivedData = await longLivedRes.json()

      if (!longLivedRes.ok || !longLivedData.access_token) {
        logger.error('Failed to exchange for Long-Lived User Access Token', { data: longLivedData })
        // Proceeding without long-lived user token might limit revocation ability later
        // throw new Error(`Facebook long-lived token exchange failed: ${longLivedData.error?.message || 'Unknown error'}`);
        logger.warn('Proceeding without Long-Lived User Token. Revocation might be affected.')
      }
      const longLivedUserToken = longLivedData.access_token // May be undefined if exchange failed
      logger.debug('Obtained Long-Lived User Access Token (if successful)', { orgId })

      // 3. Get the User's Facebook ID (optional but good for reference)
      const meRes = await fetch(
        `https://graph.facebook.com/${API_VERSION}/me?access_token=${longLivedUserToken || shortLivedUserToken}`
      )
      const meData = await meRes.json()
      const facebookUserId = meData.id

      // 4. Get Pages the user has granted access to
      const accountsUrl = `https://graph.facebook.com/${API_VERSION}/me/accounts?access_token=${longLivedUserToken || shortLivedUserToken}&fields=id,name,access_token`
      const accountsRes = await fetch(accountsUrl)
      const accountsData = await accountsRes.json()

      if (!accountsRes.ok || !accountsData.data || accountsData.data.length === 0) {
        logger.error("Failed to get user's pages or no pages found/granted", { data: accountsData })
        throw new Error('Could not retrieve Facebook Pages. Ensure permissions were granted.')
      }

      // --- User Selection Logic Needed ---
      // Ideally, the user selects which page to connect *before* or *after* this callback.
      // For this example, we'll connect the FIRST page returned.
      // In a real app, you'd present `accountsData.data` to the user.
      const selectedPage = accountsData.data[0]
      const pageId = selectedPage.id
      const pageName = selectedPage.name
      const shortLivedPageToken = selectedPage.access_token
      logger.info(
        `User granted access to pages. Auto-selecting first page: ${pageName} (${pageId})`,
        { orgId }
      )

      // 5. Exchange the short-lived Page Token for a Long-Lived Page Token
      // IMPORTANT: Use the *User* token for this exchange if possible, otherwise use the short-lived Page token.
      // Let's use the short-lived Page token as obtained from /me/accounts
      const longLivedPageUrl = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`
      const longLivedPageParams = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        fb_exchange_token: shortLivedPageToken,
      })
      const longLivedPageRes = await fetch(`${longLivedPageUrl}?${longLivedPageParams.toString()}`)
      const longLivedPageData = await longLivedPageRes.json()

      if (!longLivedPageRes.ok || !longLivedPageData.access_token) {
        logger.error('Failed to exchange for Long-Lived Page Access Token', {
          pageId,
          data: longLivedPageData,
        })
        throw new Error(
          `Facebook long-lived page token exchange failed: ${longLivedPageData.error?.message || 'Unknown error'}`
        )
      }
      const longLivedPageToken = longLivedPageData.access_token
      logger.debug('Obtained Long-Lived Page Access Token', { pageId, orgId })

      // 6. Prepare metadata
      const integrationMetadata: FacebookIntegrationMetadata = {
        pageId: pageId,
        pageName: pageName,
        pageAccessToken: longLivedPageToken,
        userAccessToken: longLivedUserToken, // Store if available
        userId: facebookUserId,
      }

      // 7. Store or update integration in the database
      // Find existing based on provider and pageId in metadata
      const existingIntegrations = await db.select()
        .from(schema.Integration)
        .where(and(
          eq(schema.Integration.organizationId, orgId),
          eq(schema.Integration.provider, 'facebook')
        ))

      // Filter by metadata in application code since Drizzle doesn't support JSON path queries elegantly
      const existingIntegration = existingIntegrations.find(integration => {
        const metadata = integration.metadata as any
        return metadata?.pageId === pageId
      })

      let integration
      if (existingIntegration) {
        // Update existing integration
        const [updatedIntegration] = await db.update(schema.Integration)
          .set({
            // Update tokens and metadata
            refreshToken: longLivedUserToken || 'N/A', // Store L-L User Token here for potential revoke/refresh
            accessToken: longLivedPageToken, // Store L-L Page Token as primary access token
            metadata: integrationMetadata as unknown as any,
            enabled: true,
            updatedAt: new Date(),
            expiresAt: null, // Page tokens don't expire in the same way JWTs do
          })
          .where(eq(schema.Integration.id, existingIntegration.id))
          .returning()
        integration = updatedIntegration
      } else {
        // Create new integration
        const [newIntegration] = await db.insert(schema.Integration)
          .values({
            organizationId: orgId,
            provider: 'facebook',
            refreshToken: longLivedUserToken || 'N/A',
            accessToken: longLivedPageToken,
            metadata: integrationMetadata as unknown as any,
            enabled: true,
            expiresAt: null,
            settings: {
              recordCreation: {
                mode: 'selective', // Default to selective mode
              },
            },
          })
          .returning()
        integration = newIntegration
      }

      const inboxService = new InboxService(db, orgId)
      await inboxService.addIntegrationToDefaultInbox(integration.id)

      // 8. Subscribe Page to App Webhooks (Essential for receiving messages)
      await this.subscribePageToApp(pageId, longLivedPageToken)

      return { success: true, integration }
    } catch (error: any) {
      logger.error('Error handling Facebook OAuth callback:', {
        error: error.message,
        stack: error.stack,
        orgId,
      })
      throw new Error(`Facebook OAuth callback failed: ${error.message}`)
    }
  }

  /**
   * Subscribe the connected page to webhook events from this app.
   */
  private async subscribePageToApp(pageId: string, pageAccessToken: string): Promise<void> {
    const subscribeUrl = `https://graph.facebook.com/${API_VERSION}/${pageId}/subscribed_apps`
    const subscribeParams = new URLSearchParams({
      subscribed_fields: FacebookOAuthService.scopes.join(','), // Subscribe to fields corresponding to granted scopes
      access_token: pageAccessToken,
    })

    try {
      const response = await fetch(subscribeUrl, { method: 'POST', body: subscribeParams })
      const data = await response.json()

      if (!response.ok || !data.success) {
        logger.error(`Failed to subscribe Page ${pageId} to app webhooks`, {
          status: response.status,
          data,
        })
        // Don't throw here, as the main auth succeeded, but log critical warning
        logger.warn(
          `Webhook subscription failed for page ${pageId}. Real-time messages may not work.`
        )
        // Consider retrying or notifying the user
      } else {
        logger.info(`Successfully subscribed Page ${pageId} to app webhooks.`)
      }
    } catch (error) {
      logger.error(`Error subscribing page ${pageId} to webhooks`, { error })
      // Log and continue
    }
  }

  /**
   * Unsubscribe the page from app webhooks.
   */
  private async unsubscribePageFromApp(pageId: string, pageAccessToken: string): Promise<void> {
    const unsubscribeUrl = `https://graph.facebook.com/${API_VERSION}/${pageId}/subscribed_apps`
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
    const [integration] = await db.select()
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!integration?.accessToken || !integration.metadata) {
      throw new Error('Integration or access token not found for refresh check.')
    }
    // const metadata = integration.metadata as unknown as FacebookIntegrationMetadata
    const pageAccessToken = integration.accessToken // This should be the long-lived PAT

    try {
      // Use the debug_token endpoint to check validity
      const debugUrl = `https://graph.facebook.com/${API_VERSION}/debug_token`
      const debugParams = new URLSearchParams({
        input_token: pageAccessToken,
        access_token: `${this.clientId}|${this.clientSecret}`, // Use App Access Token
      })

      const debugRes = await fetch(`${debugUrl}?${debugParams.toString()}`)
      const debugData = await debugRes.json()

      if (!debugRes.ok || debugData.error || !debugData.data?.is_valid) {
        logger.warn(
          `Facebook Page Access Token for integration ${integrationId} is invalid or expired.`,
          { debugData }
        )
        // Mark integration as disabled? Requires re-auth.
        await db.update(schema.Integration)
          .set({ enabled: false, accessToken: null }) // Clear invalid token
          .where(eq(schema.Integration.id, integrationId))
        throw new Error('Facebook token is invalid. Re-authentication required.')
      }

      // Token is valid, check expiry if available
      if (debugData.data.expires_at && debugData.data.expires_at !== 0) {
        const expiryDate = new Date(debugData.data.expires_at * 1000)
        logger.info(
          `Facebook token for ${integrationId} is valid. Expires: ${expiryDate.toISOString()}`
        )
        // Optionally update expiresAt in DB if different (though FB PATs are usually long-lived ~60 days or never expire)
      } else {
        logger.info(
          `Facebook token for ${integrationId} is valid and does not expire (or expiry not provided).`
        )
      }

      // Return the potentially updated integration data (even if only expiry changed)
      const [refreshedIntegration] = await db.select()
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
      const [integration] = await db.select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      if (!integration || !integration.metadata) {
        throw new Error('Integration not found or missing metadata.')
      }

      const metadata = integration.metadata as unknown as FacebookIntegrationMetadata
      const userAccessToken = integration.refreshToken // L-L User Token stored in refreshToken field
      const pageAccessToken = integration.accessToken // L-L Page Token
      const pageId = metadata.pageId
      const facebookUserId = metadata.userId // User's FB ID

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
        const revokeUrl = `https://graph.facebook.com/${API_VERSION}/${facebookUserId}/permissions`
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
            // Continue cleanup even if revocation fails
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

      // 3. Update integration record in DB: disable and clear tokens/metadata
      await db.update(schema.Integration)
        .set({
          enabled: false,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          metadata: null, // Clear metadata
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
    const [integration] = await db.select({
      accessToken: schema.Integration.accessToken,
      enabled: schema.Integration.enabled
    })
    .from(schema.Integration)
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)
    // Optionally add validity check here using refreshTokens logic if needed
    if (integration?.enabled && integration.accessToken) {
      return integration.accessToken
    }
    logger.warn('Could not retrieve valid Page Access Token.', {
      integrationId,
      enabled: integration?.enabled,
    })
    return null
  }

  /**
   * Helper to get Page ID from stored metadata.
   */
  public async getPageId(integrationId: string): Promise<string | null> {
    const [integration] = await db.select({
      metadata: schema.Integration.metadata
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
