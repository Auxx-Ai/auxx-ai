// src/lib/email/providers/google-oauth.ts

import { env, WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { InboxService } from '@auxx/lib/inboxes'
import { createScopedLogger } from '@auxx/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type Common, google } from 'googleapis'

type GaxiosError = Common.GaxiosError

const logger = createScopedLogger('google-oauth')

// Interface describing the data needed to authenticate with Google
export interface GoogleIntegration {
  id: string
  refreshToken: string
  accessToken?: string | null
  expiresAt?: Date | null
  metadata?: unknown | null
  lastHistoryId?: string | null
  lastSyncedAt?: Date | null
  // messageType removed - derived from Integration.provider
}

export class GoogleOAuthService {
  private static instance: GoogleOAuthService
  private clientId: string
  private clientSecret: string
  private redirectUri: string

  /**
   * Private constructor for the Google OAuth provider.
   */
  private constructor() {
    this.clientId = env.GOOGLE_CLIENT_ID || ''
    this.clientSecret = env.GOOGLE_CLIENT_SECRET || ''
    this.redirectUri = `${WEBAPP_URL}/api/google/oauth2/callback` // env.GOOGLE_REDIRECT_URI || ''

    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error('Google OAuth credentials not properly configured')
    }
  }

  /**
   * Gets the singleton instance of the GoogleOAuthService.
   */
  public static getInstance(): GoogleOAuthService {
    if (!GoogleOAuthService.instance) {
      GoogleOAuthService.instance = new GoogleOAuthService()
    }
    return GoogleOAuthService.instance
  }

  /**
   * Creates and returns an OAuth2 client instance for Google authentication.
   */
  public getOAuthClient(): any {
    // Type should be google.auth.OAuth2
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri)
  }

  /**
   * Creates an authenticated OAuth2 client using credentials from the provided integration.
   */
  public getAuthenticatedClient(integration: GoogleIntegration): any {
    // Type should be google.auth.OAuth2
    const oauth2Client = this.getOAuthClient()
    oauth2Client.setCredentials({
      refresh_token: integration.refreshToken,
      access_token: integration.accessToken || undefined,
      expiry_date: integration.expiresAt ? integration.expiresAt.getTime() : undefined,
    })
    return oauth2Client
  }

  /**
   * Finds an integration by ID and returns an authenticated OAuth client.
   */
  public async getClientFromIntegrationId(integrationId: string): Promise<any> {
    // Type should be google.auth.OAuth2
    const [integration] = await db
      .select()
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!integration || !integration.refreshToken) {
      throw new Error('Integration not found or missing refresh token')
    }
    // Cast to GoogleIntegration, assuming necessary fields exist
    return this.getAuthenticatedClient(integration as GoogleIntegration)
  }

  /**
   * Finds the active Google integration for an organization and returns an authenticated client.
   */
  public async getClientForOrganization(organizationId: string): Promise<any> {
    // Type should be google.auth.OAuth2
    const [integration] = await db
      .select()
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

    if (!integration || !integration.refreshToken) {
      throw new Error('No active Google integration found for this organization')
    }
    return this.getAuthenticatedClient(integration as GoogleIntegration)
  }

  /**
   * Generates a Google OAuth URL for authorizing access to Gmail APIs.
   * Enhanced to support both initial authentication and re-authentication flows.
   */
  public getAuthUrl(
    organizationId: string,
    userId: string,
    options: {
      redirectPath?: string
      integrationId?: string // For re-auth context
      isReauth?: boolean // Force consent for re-auth
      type?: 'initial' | 'reauth' // Auth type for callback handling
    } = {}
  ): string {
    const oauth2Client = this.getOAuthClient()
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

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      // Always force consent to ensure we receive a refresh token
      // Google only returns refresh_token on first auth or when prompt=consent
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/pubsub',
        'https://www.googleapis.com/auth/userinfo.email', // Request email scope
      ],
      state: JSON.stringify(stateWithContext),
      include_granted_scopes: true, // Ensure we get fresh permissions
    })

    logger.info('Generated Google OAuth URL', {
      organizationId,
      userId,
      isReauth: options.isReauth,
      integrationId: options.integrationId,
    })

    return url
  }

  /**
   * Handles the OAuth callback from Google.
   */
  public async handleCallback(
    code: string,
    stateString: string
  ): Promise<{ success: boolean; integration: any; isReauth?: boolean }> {
    try {
      let state
      try {
        state = JSON.parse(stateString)
      } catch (e) {
        logger.error('Invalid state parameter:', { error: e })
        throw new Error('Invalid state parameter')
      }

      const { orgId, userId, type, integrationId } = state
      if (!orgId || !userId) {
        throw new Error('Missing organization or user ID in state')
      }

      const isReauth = type === 'reauth'
      logger.info('Handling Google OAuth callback', { orgId, userId, isReauth, integrationId })

      const oauth2Client = this.getOAuthClient()
      const { tokens } = await oauth2Client.getToken(code)

      if (!tokens.refresh_token) {
        logger.error('No refresh token received')
        throw new Error('No refresh token received from Google')
      }

      oauth2Client.setCredentials(tokens)

      // Get user email using the userinfo API (more reliable than Gmail profile)
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
      const userInfo = await oauth2.userinfo.get()
      const email = userInfo.data.email

      if (!email) {
        throw new Error('Could not retrieve email address from Google')
      }

      // Prepare metadata including the email address
      const integrationMetadata = { email: email } // Store email in metadata

      // Handle re-authentication flow
      if (isReauth && integrationId) {
        logger.info('Processing re-authentication for existing integration', { integrationId })

        const [integration] = await db
          .update(schema.Integration)
          .set({
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            email: email, // Update email field directly
            metadata: integrationMetadata, // Update metadata
            enabled: true,
            // Clear authentication error status
            authStatus: 'AUTHENTICATED',
            lastAuthError: null,
            lastAuthErrorAt: null,
            requiresReauth: false,
            lastSuccessfulSync: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, integrationId))
          .returning()

        logger.info('Re-authentication successful', { integrationId, email })

        // Set up Gmail webhooks (push notifications) - may have expired
        try {
          await this.setupPushNotifications(integrationId)
        } catch (webhookError) {
          logger.warn('Failed to setup webhooks during re-auth', {
            integrationId,
            error: (webhookError as Error).message,
          })
          // Don't fail the re-auth for webhook issues
        }

        return {
          success: true,
          integration,
          isReauth: true,
        }
      }

      // Handle initial authentication flow (existing logic)
      // Find existing integration by provider and email
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

      // Store or update integration in the database
      let integration
      if (existingIntegration) {
        // Update existing integration
        ;[integration] = await db
          .update(schema.Integration)
          .set({
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            enabled: true,
            metadata: integrationMetadata, // Update metadata
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, existingIntegration.id))
          .returning()
      } else {
        // Create new integration
        ;[integration] = await db
          .insert(schema.Integration)
          .values({
            organizationId: orgId,
            provider: 'google', // Explicitly set provider - messageType derived from this
            refreshToken: tokens.refresh_token,
            accessToken: tokens.access_token,
            expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
            enabled: true,
            metadata: integrationMetadata, // Set metadata
            email: email,
            settings: {
              recordCreation: {
                mode: 'selective', // Default to selective mode
              },
            },
            updatedAt: new Date(),
          })
          .returning()
      }

      const inboxService = new InboxService(db, orgId, userId)
      await inboxService.addIntegrationToDefaultInbox(integration!.id)

      // Set up Gmail webhooks (push notifications)
      await this.setupPushNotifications(integration!.id)

      return { success: true, integration }
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
   * Refreshes OAuth tokens for a Google integration.
   */
  public async refreshTokens(integrationId: string): Promise<any> {
    try {
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (!integration || !integration.refreshToken) {
        throw new Error('Integration not found or missing refresh token')
      }

      const oauth2Client = this.getOAuthClient()
      oauth2Client.setCredentials({ refresh_token: integration.refreshToken })

      const { credentials } = await oauth2Client.refreshAccessToken()

      // Update tokens in database
      const updateData: any = {
        accessToken: credentials.access_token,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      }

      // Update refresh token ONLY if a new one is provided by Google
      if (credentials.refresh_token && credentials.refresh_token !== integration.refreshToken) {
        updateData.refreshToken = credentials.refresh_token
      }

      const [updatedIntegration] = await db
        .update(schema.Integration)
        .set(updateData)
        .where(eq(schema.Integration.id, integrationId))
        .returning()

      return updatedIntegration
    } catch (error: any) {
      logger.error('Error refreshing Google access token:', {
        error: error.message,
        response: error.response?.data,
        integrationId,
      })
      // Handle specific errors like 'invalid_grant' which might mean the token was revoked
      if (error.response?.data?.error === 'invalid_grant') {
        logger.warn('Refresh token is invalid or revoked. Disabling integration.', {
          integrationId,
        })
        // Optionally disable the integration in the DB
        await db
          .update(schema.Integration)
          .set({ enabled: false, accessToken: null, refreshToken: 'REVOKED' }) // Mark token as revoked
          .where(eq(schema.Integration.id, integrationId))
        throw new Error('Google refresh token is invalid or revoked.')
      }
      throw new Error(`Failed to refresh Google access token: ${error.message}`)
    }
  }

  /**
   * Revokes access to a Google OAuth integration.
   */
  public async revokeAccess(integrationId: string): Promise<boolean> {
    try {
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)

      if (!integration) {
        throw new Error('Integration not found')
      }

      // Disable inbox watching first
      // Pass integration object to avoid extra DB lookup
      await this.disablePushNotifications(integrationId, integration as GoogleIntegration)

      // Revoke the token using Google's API
      const oauth2Client = this.getOAuthClient()
      // Try revoking both access and refresh tokens if they exist
      const tokensToRevoke = [integration.accessToken, integration.refreshToken].filter(Boolean)

      for (const token of tokensToRevoke) {
        try {
          if (token) {
            // Ensure token is not null/empty
            await oauth2Client.revokeToken(token)
            logger.info(`Successfully revoked token type for integration ${integrationId}`)
          }
        } catch (error: any) {
          // If token already expired or revoked, just log and continue
          if (error.response?.data?.error === 'invalid_token') {
            logger.info(`Token already invalid/revoked during revocation attempt`, {
              integrationId,
            })
          } else {
            // Log other errors but continue with database update
            logger.warn('Failed to revoke token with Google (continuing DB update)', {
              error: error.message,
              response: error.response?.data,
              integrationId,
            })
          }
        }
      }

      // Update integration record: disable and clear tokens
      await db
        .update(schema.Integration)
        .set({
          enabled: false,
          accessToken: null,
          refreshToken: null, // Clear refresh token upon explicit revocation
          expiresAt: null,
          // Consider clearing metadata or specific fields within it if sensitive
          // metadata: null // Or update specific keys to null
        })
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
  private async setupPushNotifications(integrationId: string): Promise<void> {
    try {
      // Get client using the integration ID, which handles fetching/auth
      const oauth2Client = await this.getClientFromIntegrationId(integrationId)
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

      const topicName = `projects/${env.GOOGLE_PROJECT_ID}/topics/${env.GOOGLE_PUBSUB_TOPIC}`

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
      // Don't throw from private helper during callback, but log severity.
      // Throwing here would fail the initial OAuth connection.
      // Maybe re-throw if called explicitly later?
      throw new Error(`Failed to set up Gmail push notifications: ${gaxiosError.message}`)
    }
  }

  /**
   * Disables Gmail push notifications for a given integration.
   */
  private async disablePushNotifications(
    integrationId: string,
    integration?: GoogleIntegration
  ): Promise<void> {
    try {
      let oauth2Client: any
      if (integration) {
        // Use provided integration data if available
        oauth2Client = this.getAuthenticatedClient(integration)
      } else {
        // Fetch integration if not provided
        oauth2Client = await this.getClientFromIntegrationId(integrationId)
      }

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

      await gmail.users.stop({ userId: 'me' })

      logger.info('Gmail push notifications (watch) disabled successfully', { integrationId })
    } catch (error: any) {
      const gaxiosError = error as GaxiosError
      // Common errors: 401 (invalid_grant/expired token), 404 (no watch active)
      if (gaxiosError.response?.status === 404) {
        logger.warn('No active Gmail watch found to disable.', { integrationId })
        // Not an error in this context.
      } else if (gaxiosError.response?.data?.error === 'invalid_grant') {
        logger.warn(
          'Invalid grant while trying to disable push notifications (token likely expired/revoked).',
          { integrationId }
        )
        // Cannot disable if token is bad, but proceed with cleanup.
      } else {
        logger.error('Error disabling Gmail push notifications:', {
          message: gaxiosError.message,
          status: gaxiosError.response?.status,
          data: gaxiosError.response?.data,
          integrationId,
        })
        // Log warning, don't throw during cleanup like revokeAccess
        logger.warn('Continuing cleanup despite push notification disabling error.', {
          integrationId,
        })
      }
    }
  }
}
