// src/lib/providers/outlook/outlook-oauth.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import type { MessageType } from '@auxx/database/enums'
import type { IntegrationEntity } from '@auxx/database/models'
import { InboxService } from '@auxx/lib/inboxes'
import { createScopedLogger } from '@auxx/logger'
import {
  // AuthenticationResult,
  type AccountInfo,
  ConfidentialClientApplication,
  LogLevel,
} from '@azure/msal-node'
import { Client } from '@microsoft/microsoft-graph-client'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('outlook-oauth')
// Interface describing the data stored in Integration.metadata for Outlook
export interface OutlookIntegrationMetadata {
  email: string // Primary email address
  homeAccountId: string // MSAL's unique ID for the account in this tenant
}
// Interface describing the data needed internally for authentication methods
export interface OutlookAuthContext {
  id: string // Integration ID
  refreshToken: string
  accessToken?: string | null
  expiresAt?: Date | null
  metadata?: any | null
  email?: string
  homeAccountId?: string
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
   * Loads a refresh token into the MSAL cache to ensure it's available for token operations
   */
  // private loadRefreshTokenIntoCache(homeAccountId: string, refreshToken: string): void {
  //   try {
  //     // Create the minimal cache structure that MSAL needs
  //     const tokenCacheItem = {
  //       RefreshToken: {
  //         [`${homeAccountId}-login.microsoftonline.com-refreshtoken-${this.clientId}--`]: {
  //           homeAccountId: homeAccountId,
  //           environment: 'login.microsoftonline.com',
  //           credentialType: 'RefreshToken',
  //           clientId: this.clientId,
  //           secret: refreshToken,
  //         },
  //       },
  //     }
  //     // Deserialize into MSAL cache
  //     this.msalClient.getTokenCache().deserialize(JSON.stringify(tokenCacheItem))
  //     logger.info('Successfully loaded refresh token into MSAL cache', { homeAccountId })
  //   } catch (error) {
  //     logger.error('Failed to load refresh token into MSAL cache', { error, homeAccountId })
  //   }
  // }
  private loadRefreshTokenIntoCache(
    homeAccountId: string,
    refreshToken: string,
    email: string
  ): void {
    try {
      // Create a more complete cache structure that includes BOTH token AND account data
      const cacheJson = {
        Account: {
          [`${homeAccountId}-login.microsoftonline.com-`]: {
            home_account_id: homeAccountId,
            environment: 'login.microsoftonline.com',
            realm: '',
            local_account_id: homeAccountId,
            username: email,
            authority_type: 'MSSTS',
            name: email,
          },
        },
        RefreshToken: {
          [`${homeAccountId}-login.microsoftonline.com-refreshtoken-${this.clientId}--`]: {
            home_account_id: homeAccountId,
            environment: 'login.microsoftonline.com',
            credential_type: 'RefreshToken',
            client_id: this.clientId,
            secret: refreshToken,
            realm: '',
            target: OutlookOAuthService.scopes.join(' '),
          },
        },
      }
      // Deserialize into MSAL cache
      this.msalClient.getTokenCache().deserialize(JSON.stringify(cacheJson))
      logger.info('Successfully loaded account and refresh token into MSAL cache', {
        homeAccountId,
      })
    } catch (error) {
      logger.error('Failed to load refresh token into MSAL cache', { error, homeAccountId })
    }
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
      // 4. Prepare Metadata
      const integrationMetadata: OutlookIntegrationMetadata = {
        email: email,
        homeAccountId: response.account.homeAccountId,
      }
      const expiresOn = response.expiresOn
        ? new Date(response.expiresOn)
        : new Date(Date.now() + (response.expiresIn || 3600) * 1000)
      // Handle re-authentication flow
      if (isReauth && integrationId) {
        logger.info('Processing re-authentication for existing Outlook integration', {
          integrationId,
        })
        const [integration] = await db
          .update(schema.Integration)
          .set({
            refreshToken: refreshToken,
            accessToken: response.accessToken,
            expiresAt: expiresOn,
            email: email, // Update email field directly
            metadata: integrationMetadata as any, // Update metadata
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
        logger.info('Re-authentication successful for Outlook integration', {
          integrationId,
          email,
        })
        return {
          success: true,
          integration,
          isReauth: true,
        }
      }
      // 5. Store or Update Integration in DB (initial authentication flow)
      // Note: Drizzle doesn't support JSON path queries as elegantly as drizzle
      // We'll need to fetch and check manually or use a different approach
      const existingIntegrations = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.organizationId, orgId))
      const existingIntegration = existingIntegrations.find(
        (integration) =>
          integration.provider === 'outlook' && (integration.metadata as any)?.email === email
      )
      const integrationData = {
        refreshToken: refreshToken,
        accessToken: response.accessToken,
        expiresAt: expiresOn,
        metadata: integrationMetadata as any,
        enabled: true,
        updatedAt: new Date(),
      }
      let integration: IntegrationEntity
      if (existingIntegration) {
        // Update existing integration
        const [updated] = await db
          .update(schema.Integration)
          .set(integrationData)
          .where(eq(schema.Integration.id, existingIntegration.id))
          .returning()
        integration = updated
      } else {
        // Create new integration
        const [created] = await db
          .insert(schema.Integration)
          .values({
            ...integrationData,
            organizationId: orgId,
            provider: 'outlook',
            messageType: 'EMAIL' as MessageType,
            settings: {
              recordCreation: {
                mode: 'selective', // Default to selective mode
              },
            },
          })
          .returning()
        integration = created
      }
      const inboxService = new InboxService(db, orgId, userId)
      await inboxService.addIntegrationToDefaultInbox(integration.id)
      // const inboxes = await inboxService.getInboxes()
      // if(!inboxes || inboxes.length === 0) {
      //   const defaultInbox = await inboxService.createInbox({
      //     name: 'Shared Inbox',
      //     description: 'Default shared inbox for all team members',
      //     color: '#A7C1F2', // Light Blue
      //     status: 'ACTIVE',
      //     allowAllMembers: true, // All members have access by default
      //     enableMemberAccess: false,
      //     enableGroupAccess: false,
      //   })
      // }
      // Create a default shared inbox
      // InboxService.getInstance().updateIntegrationInboxes(integration.id, orgId, userId)
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
  /** Helper to extract refresh token from cache */
  private extractRefreshToken(homeAccountId: string): string | undefined {
    try {
      const tokenCache = this.msalClient.getTokenCache().serialize()
      const parsedCache = JSON.parse(tokenCache)
      // Look for the refresh token in the cache
      if (parsedCache.RefreshToken) {
        // Find a key that contains the homeAccountId
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
  /** Helper to create a temporary Graph client with a specific token */
  private createTemporaryGraphClient(accessToken: string): Client {
    return Client.init({
      authProvider: (done) => {
        done(null, accessToken)
      },
    })
  }
  /** Refreshes the access token using the stored refresh token via MSAL silent flow */
  public async refreshTokens(integrationId: string): Promise<IntegrationEntity> {
    try {
      const [integration] = await db
        .select()
        .from(schema.Integration)
        .where(eq(schema.Integration.id, integrationId))
        .limit(1)
      if (!integration || !integration.refreshToken) {
        throw new Error('Integration not found or missing refresh token')
      }
      const metadata = integration.metadata as unknown as Partial<OutlookIntegrationMetadata>
      const homeAccountId = metadata?.homeAccountId
      const email = metadata?.email || ''
      if (!homeAccountId) {
        logger.error(
          'Home Account ID missing in metadata, cannot perform silent token acquisition.',
          { integrationId }
        )
        throw new Error(
          'Cannot refresh token: Account identifier missing. Re-authentication may be required.'
        )
      }
      // CRITICAL: Load the refresh token into MSAL's cache before attempting to use it
      this.loadRefreshTokenIntoCache(homeAccountId, integration.refreshToken, email)
      // Create a minimal account object for the request
      const account = {
        homeAccountId: homeAccountId,
        environment: 'login.microsoftonline.com',
        tenantId: 'common',
        username: metadata.email || '',
      } as AccountInfo
      const silentRequest = {
        account: account,
        scopes: OutlookOAuthService.scopes,
        forceRefresh: true, // Force refresh to ensure we get a new token
      }
      logger.debug('Attempting silent token acquisition (refresh)', {
        integrationId,
        homeAccountId,
      })
      const response = await this.msalClient.acquireTokenSilent(silentRequest)
      if (!response || !response.accessToken) {
        throw new Error('Silent token acquisition failed to return an access token')
      }
      logger.info('Outlook token refreshed successfully via silent acquisition', { integrationId })
      const expiresOn = response.expiresOn
        ? new Date(response.expiresOn)
        : new Date(Date.now() + (response.expiresIn || 3600) * 1000)
      // Extract potential new refresh token (check if MSAL rotated it)
      const newRefreshToken = this.extractRefreshToken(homeAccountId)
      // Update tokens in the database
      const [updatedIntegration] = await db
        .update(schema.Integration)
        .set({
          accessToken: response.accessToken,
          expiresAt: expiresOn,
          // Only update RT if a new one was extracted AND it's different
          ...(newRefreshToken && newRefreshToken !== integration.refreshToken
            ? { refreshToken: newRefreshToken }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, integrationId))
        .returning()
      return updatedIntegration
    } catch (error: unknown) {
      const err = error as {
        message?: string
        errorCode?: string
        errorMessage?: string
      }
      logger.error('Error refreshing Outlook access token:', {
        error: err.message,
        errorCode: err.errorCode,
        errorMessage: err.errorMessage,
        integrationId,
      })
      // Handle specific errors like 'invalid_grant'
      if (err.errorCode === 'invalid_grant' || err.errorMessage?.includes('AADSTS70008')) {
        logger.warn('Outlook refresh token is invalid or revoked. Disabling integration.', {
          integrationId,
        })
        await db
          .update(schema.Integration)
          .set({ enabled: false, accessToken: null, refreshToken: 'REVOKED', expiresAt: null })
          .where(eq(schema.Integration.id, integrationId))
          .catch((dbErr: unknown) =>
            logger.error('Failed to disable integration after invalid grant', { dbErr })
          )
        throw new Error('Outlook refresh token is invalid or revoked. Re-authentication required.')
      }
      throw new Error(`Failed to refresh Outlook access token: ${err.message || err.errorCode}`)
    }
  }
  /** Revokes access (clears local tokens and disables). */
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
      logger.warn('Attempting to revoke Outlook access (clearing local tokens & disabling)', {
        integrationId,
      })
      // Update DB: Disable and Clear Tokens/Metadata
      await db
        .update(schema.Integration)
        .set({
          enabled: false,
          accessToken: null,
          refreshToken: null, // Clear refresh token on explicit revoke
          expiresAt: null,
          metadata: null, // Clear metadata
        })
        .where(eq(schema.Integration.id, integrationId))
      logger.info(
        `Cleared tokens/metadata and disabled Outlook integration ${integrationId} in DB.`
      )
      return true
    } catch (error: unknown) {
      const err = error as {
        message?: string
      }
      logger.error('Error revoking Outlook access:', { error: err.message, integrationId })
      throw new Error(`Failed to revoke Outlook access: ${err.message}`)
    }
  }
  public getAuthenticatedClient(integration: OutlookAuthContext): Client {
    if (!integration.id || !integration.refreshToken || !integration.metadata) {
      throw new Error(
        'Cannot create authenticated client: Integration context missing essential data (ID, refreshToken, metadata).'
      )
    }
    const metadata = integration.metadata as unknown as Partial<OutlookIntegrationMetadata>
    const homeAccountId = metadata?.homeAccountId
    const email = metadata?.email || ''
    if (!homeAccountId) {
      logger.error(
        'Home Account ID missing in integration metadata. Cannot perform silent token acquisition.',
        { integrationId: integration.id }
      )
      throw new Error('Account identifier missing, cannot acquire token silently.')
    }
    // CRITICAL: Load BOTH the account and refresh token into MSAL's cache
    this.loadRefreshTokenIntoCache(homeAccountId, integration.refreshToken, email)
    // Create the Graph Client with an MSAL authProvider
    const client = Client.init({
      authProvider: async (done) => {
        try {
          // Create minimal account object
          const account = {
            homeAccountId: homeAccountId,
            environment: 'login.microsoftonline.com',
            tenantId: 'common',
            username: email,
            localAccountId: homeAccountId, // Add this as per GitHub issue
          } as AccountInfo
          const silentRequest = {
            account: account,
            scopes: OutlookOAuthService.scopes,
            forceRefresh: false,
          }
          // First verify we have the account in cache
          const accounts = await this.msalClient.getTokenCache().getAllAccounts()
          const matchingAccount = accounts.find((a) => a.homeAccountId === homeAccountId)
          if (!matchingAccount) {
            logger.warn('Account not found in cache before silent acquisition, reloading...', {
              homeAccountId,
              integrationId: integration.id,
              accountsInCache: accounts.length,
            })
            // Reload the cache explicitly
            this.loadRefreshTokenIntoCache(homeAccountId, integration.refreshToken, email)
          }
          // Acquire token silently (uses cache or refresh token)
          const response = await this.msalClient.acquireTokenSilent(silentRequest)
          if (!response || !response.accessToken) {
            throw new Error('acquireTokenSilent failed to return an access token.')
          }
          // Optionally update DB if expiry changed significantly (though less critical now)
          const newExpiresOn = response.expiresOn ? new Date(response.expiresOn) : null
          if (newExpiresOn && newExpiresOn?.getTime() !== integration.expiresAt?.getTime()) {
            // Perform non-critical DB update in background
            db.update(schema.Integration)
              .set({ accessToken: response.accessToken, expiresAt: newExpiresOn })
              .where(eq(schema.Integration.id, integration.id))
              .catch((err: unknown) =>
                logger.error('Background DB update failed in authProvider', { err })
              )
          }
          // Successfully acquired token
          done(null, response.accessToken)
        } catch (error) {
          const err = error as {
            message?: string
            errorCode?: string
            errorMessage?: string
          }
          logger.error('Error acquiring token silently in Graph authProvider:', {
            error: err.message,
            errorCode: err.errorCode,
            integrationId: integration.id,
          })
          // Handle 'invalid_grant' specifically - indicates refresh token failed
          if (err.errorCode === 'invalid_grant' || err.errorMessage?.includes('AADSTS70008')) {
            logger.warn('Refresh token invalid during silent acquisition. Disabling integration.', {
              integrationId: integration.id,
            })
            // Disable integration in background
            db.update(schema.Integration)
              .set({
                enabled: false,
                accessToken: null,
                refreshToken: 'REVOKED',
                expiresAt: null,
              })
              .where(eq(schema.Integration.id, integration.id))
              .catch((dbErr: unknown) =>
                logger.error('Failed to disable integration after invalid grant', { dbErr })
              )
          }
          // Other errors might be transient (network) or require interaction (consent needed)
          // Pass the error back to the Graph client SDK
          done(error as Error, null)
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
