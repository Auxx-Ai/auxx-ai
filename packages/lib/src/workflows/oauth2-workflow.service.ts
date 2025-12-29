// packages/lib/src/workflows/oauth2-workflow.service.ts

import { env, WEBAPP_URL } from '@auxx/config/server'
import { createScopedLogger } from '@auxx/logger'
import type {
  OAuth2Config,
  OAuth2State,
  OAuth2Tokens,
  OAuth2InitiationResponse,
  OAuth2CallbackResult,
  OAuth2CredentialData,
} from '@auxx/workflow-nodes/types'
import { URLTemplateService } from '@auxx/workflow-nodes/server'
// import { CredentialService } from '../workflow-engine/services/credential-service'
import { CredentialTypeRegistry } from '@auxx/credentials' //'../credentials/credential-type-registry'
import { CredentialService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'

const logger = createScopedLogger('oauth2-workflow')

/**
 * Generic OAuth2 service for workflow credentials
 * Supports any OAuth2 provider with system-wide client credentials
 */
export class OAuth2WorkflowService {
  private static instance: OAuth2WorkflowService
  private credentialTypeRegistry: CredentialTypeRegistry

  private constructor() {
    this.credentialTypeRegistry = new CredentialTypeRegistry()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): OAuth2WorkflowService {
    if (!OAuth2WorkflowService.instance) {
      OAuth2WorkflowService.instance = new OAuth2WorkflowService()
    }
    return OAuth2WorkflowService.instance
  }

  /**
   * Initiate OAuth2 flow for a credential type
   */
  public async initiateOAuth(
    oauth2Config: OAuth2Config,
    organizationId: string,
    userId: string,
    credentialType: string,
    credentialName: string,
    credentialData?: Record<string, any>
  ): Promise<OAuth2InitiationResponse> {
    try {
      // Get system client credentials from environment
      const clientId = this.getSystemClientId(oauth2Config)

      if (!clientId) {
        throw new Error(`System client ID not configured for ${oauth2Config.providerName}`)
      }

      // Generate secure state parameter
      const state: OAuth2State = {
        organizationId,
        userId,
        credentialType,
        credentialName,
        nonce: this.generateNonce(),
        timestamp: Date.now(),
      }

      const encodedState = this.encodeState(state)

      // Build authorization URL
      const authUrl = this.buildAuthUrl(oauth2Config, clientId, encodedState, credentialData)

      logger.info('OAuth2 flow initiated', {
        provider: oauth2Config.providerName,
        organizationId,
        userId,
        credentialType,
      })

      return {
        authUrl,
        state: encodedState,
      }
    } catch (error) {
      logger.error('Failed to initiate OAuth2 flow', {
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: oauth2Config.providerName,
        organizationId,
        userId,
      })
      throw error
    }
  }

  /**
   * Handle OAuth2 callback and create credential
   */
  public async handleCallback(code: string, stateParam: string): Promise<OAuth2CallbackResult> {
    try {
      logger.info('OAuth2 callback started', {
        hasCode: !!code,
        hasState: !!stateParam,
        codeLength: code?.length || 0,
      })

      // Decode and validate state
      const state = this.decodeState(stateParam)
      logger.info('OAuth2 state decoded', {
        organizationId: state.organizationId,
        userId: state.userId,
        credentialType: state.credentialType,
        credentialName: state.credentialName,
      })

      this.validateState(state)
      logger.info('OAuth2 state validated successfully')

      // Get OAuth2 config for this credential type
      const oauth2Config = await this.getOAuth2ConfigForType(state.credentialType)
      if (!oauth2Config) {
        throw new Error(`OAuth2 config not found for credential type: ${state.credentialType}`)
      }
      logger.info('OAuth2 config retrieved', { provider: oauth2Config.providerName })

      // Validate environment variables
      const clientId = this.getSystemClientId(oauth2Config)
      const clientSecret = this.getSystemClientSecret(oauth2Config)
      if (!clientId || !clientSecret) {
        throw new Error(
          `Missing OAuth2 environment variables: ${oauth2Config.systemClientIdEnv}, ${oauth2Config.systemClientSecretEnv}`
        )
      }
      logger.info('OAuth2 environment variables validated')

      // Exchange code for tokens
      logger.info('Exchanging authorization code for tokens')
      const tokens = await this.exchangeCodeForTokens(oauth2Config, code, undefined)
      logger.info('Tokens exchanged successfully', {
        hasAccessToken: !!tokens.accessToken,
        hasRefreshToken: !!tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })

      // Get user info from provider
      logger.info('Retrieving user info from provider')
      const userInfo = await this.getUserInfo(oauth2Config, tokens)
      logger.info('User info retrieved', {
        hasEmail: !!userInfo.email,
        hasUserId: !!userInfo.userId,
        email: userInfo.email,
      })

      // Prepare credential data
      const credentialData: OAuth2CredentialData = {
        provider: oauth2Config.providerName,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        scopes: tokens.scopes || oauth2Config.scopes,
        expiresAt: tokens.expiresAt?.toISOString(),
        metadata: {
          email: userInfo.email,
          userId: userInfo.userId,
          providerConfig: state.credentialType,
          ...tokens.metadata,
        },
      }
      logger.info('Credential data prepared', {
        provider: credentialData.provider,
        hasAccessToken: !!credentialData.accessToken,
        hasRefreshToken: !!credentialData.refreshToken,
        scopeCount: credentialData.scopes.length,
      })

      // Save credential using existing service
      logger.info('Saving credential to database', {
        organizationId: state.organizationId,
        userId: state.userId,
        credentialType: state.credentialType,
        credentialName: state.credentialName,
      })

      const credentialId = await CredentialService.saveCredential(
        state.organizationId,
        state.userId,
        state.credentialType,
        state.credentialName,
        credentialData
      )

      logger.info('OAuth2 credential created successfully', {
        credentialId,
        provider: oauth2Config.providerName,
        organizationId: state.organizationId,
        userEmail: userInfo.email,
      })

      return {
        success: true,
        credentialId,
        userInfo,
      }
    } catch (error) {
      logger.error('OAuth2 callback failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }
    }
  }

  /**
   * Existing method - for backward compatibility (tRPC endpoint)
   * Queries for credential type, then delegates to optimized implementation
   */
  public async refreshTokens(credentialId: string, organizationId: string): Promise<boolean> {
    try {
      // Query for type + appId (needed for routing)
      const credential = await db.query.WorkflowCredentials.findFirst({
        columns: {
          id: true,
          type: true,
          appId: true,
          consecutiveRefreshFailures: true,
        },
        where: eq(schema.WorkflowCredentials.id, credentialId),
      })

      if (!credential) {
        throw new Error('Credential not found')
      }

      // Delegate to optimized implementation
      const result = await this.refreshTokensInternal({
        credentialId,
        organizationId,
        appId: credential.appId || '',
        credentialType: credential.type,
        previousFailureCount: credential.consecutiveRefreshFailures,
      })

      return result.success
    } catch (error) {
      logger.error('Token refresh failed', {
        credentialId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * Optimized method for job - accepts pre-fetched metadata
   * Avoids extra query for credential type
   */
  public async refreshTokensWithMetadata(params: {
    credentialId: string
    organizationId: string
    appId: string
    credentialType: string
    previousFailureCount: number
  }): Promise<{
    success: boolean
    expiresAt?: Date | null
    error?: string
    newFailureCount?: number
    circuitOpened?: boolean
  }> {
    return this.refreshTokensInternal(params)
  }

  /**
   * Get system client ID from environment
   */
  private getSystemClientId(oauth2Config: OAuth2Config): string | null {
    return (env as any)[oauth2Config.systemClientIdEnv] || null
  }

  /**
   * Get system client secret from environment
   */
  private getSystemClientSecret(oauth2Config: OAuth2Config): string | null {
    return (env as any)[oauth2Config.systemClientSecretEnv] || null
  }

  /**
   * Build OAuth2 authorization URL
   */
  private buildAuthUrl(
    oauth2Config: OAuth2Config,
    clientId: string,
    state: string,
    credentialData?: Record<string, any>
  ): string {
    // Apply URL transformations if configured
    const authUrl = oauth2Config.urlTransforms?.authUrl
      ? URLTemplateService.replaceTemplate(
          oauth2Config.authUrl,
          credentialData || {},
          oauth2Config.urlTransforms.authUrl
        )
      : oauth2Config.authUrl

    // Validate that all placeholders were resolved
    if (!URLTemplateService.isFullyResolved(authUrl)) {
      const unresolvedPlaceholders = URLTemplateService.getPlaceholders(authUrl)
      logger.warn('Auth URL has unresolved placeholders', {
        provider: oauth2Config.providerName,
        placeholders: unresolvedPlaceholders,
        authUrl,
      })
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${WEBAPP_URL}/api/workflows/oauth2/callback`,
      response_type: 'code',
      scope: oauth2Config.scopes.join(' '),
      state,
      ...oauth2Config.additionalAuthParams,
    })

    return `${authUrl}?${params.toString()}`
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(
    oauth2Config: OAuth2Config,
    code: string,
    credentialData?: Record<string, any>
  ): Promise<OAuth2Tokens> {
    const clientId = this.getSystemClientId(oauth2Config)
    const clientSecret = this.getSystemClientSecret(oauth2Config)

    if (!clientId || !clientSecret) {
      throw new Error('System OAuth2 credentials not configured')
    }

    // Apply URL transformations to token URL if configured
    const tokenUrl = oauth2Config.urlTransforms?.tokenUrl
      ? URLTemplateService.replaceTemplate(
          oauth2Config.tokenUrl,
          credentialData || {},
          oauth2Config.urlTransforms.tokenUrl
        )
      : oauth2Config.tokenUrl

    // Validate that all placeholders were resolved
    if (!URLTemplateService.isFullyResolved(tokenUrl)) {
      const unresolvedPlaceholders = URLTemplateService.getPlaceholders(tokenUrl)
      logger.warn('Token URL has unresolved placeholders', {
        provider: oauth2Config.providerName,
        placeholders: unresolvedPlaceholders,
        tokenUrl,
      })
    }

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${WEBAPP_URL}/api/workflows/oauth2/callback`,
      ...oauth2Config.additionalTokenParams,
    })

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
    }

    const tokenData = await response.json()

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      scopes: tokenData.scope ? tokenData.scope.split(' ') : undefined,
      tokenType: tokenData.token_type || 'Bearer',
    }
  }


  /**
   * Get user info from OAuth2 provider
   */
  private async getUserInfo(
    oauth2Config: OAuth2Config,
    tokens: OAuth2Tokens
  ): Promise<{ email?: string; userId?: string; name?: string }> {
    // Provider-specific user info endpoints
    const userInfoEndpoints: Record<string, string> = {
      google: 'https://www.googleapis.com/oauth2/v2/userinfo',
      microsoft: 'https://graph.microsoft.com/v1.0/me',
      github: 'https://api.github.com/user',
    }

    const endpoint = userInfoEndpoints[oauth2Config.providerName]
    if (!endpoint) {
      return {} // Return empty if no user info endpoint configured
    }

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `${tokens.tokenType || 'Bearer'} ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        logger.warn('Failed to fetch user info', {
          provider: oauth2Config.providerName,
          status: response.status,
        })
        return {}
      }

      const userInfo = await response.json()

      // Normalize user info across providers
      return {
        email: userInfo.email || userInfo.mail || userInfo.userPrincipalName,
        userId: userInfo.id || userInfo.sub,
        name:
          userInfo.name ||
          userInfo.displayName ||
          `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim(),
      }
    } catch (error) {
      logger.warn('Failed to fetch user info', {
        provider: oauth2Config.providerName,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return {}
    }
  }

  /**
   * Generate secure random nonce
   */
  private generateNonce(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Encode state parameter
   */
  private encodeState(state: OAuth2State): string {
    return Buffer.from(JSON.stringify(state)).toString('base64url')
  }

  /**
   * Decode state parameter
   */
  private decodeState(stateParam: string): OAuth2State {
    try {
      const decoded = Buffer.from(stateParam, 'base64url').toString('utf-8')
      return JSON.parse(decoded)
    } catch (error) {
      throw new Error('Invalid state parameter')
    }
  }

  /**
   * Validate state parameter
   */
  private validateState(state: OAuth2State): void {
    // Check timestamp (valid for 10 minutes)
    const maxAge = 10 * 60 * 1000 // 10 minutes
    if (Date.now() - state.timestamp > maxAge) {
      throw new Error('OAuth state expired')
    }

    // Validate required fields
    if (!state.organizationId || !state.userId || !state.credentialType || !state.nonce) {
      throw new Error('Invalid OAuth state')
    }
  }

  /**
   * Internal implementation - handles all database operations in minimal queries
   * Used by both public entry points
   */
  private async refreshTokensInternal(params: {
    credentialId: string
    organizationId: string
    appId: string
    credentialType: string
    previousFailureCount: number
  }): Promise<{
    success: boolean
    expiresAt?: Date | null
    error?: string
    newFailureCount?: number
    circuitOpened?: boolean
  }> {
    const { credentialId, organizationId, appId, credentialType, previousFailureCount } = params

    try {
      // QUERY 1: Get credential data (single query with all needed columns)
      const credential = await db.query.WorkflowCredentials.findFirst({
        columns: {
          id: true,
          encryptedData: true,
          consecutiveRefreshFailures: true,
        },
        where: eq(schema.WorkflowCredentials.id, credentialId),
      })

      if (!credential) {
        return { success: false, error: 'Credential not found' }
      }

      // Decrypt tokens (no query)
      const oauth2Data = CredentialService.decrypt(credential.encryptedData) as {
        accessToken: string
        refreshToken?: string
        expiresAt?: string
        metadata?: Record<string, any>
      }

      if (!oauth2Data.refreshToken) {
        return { success: false, error: 'No refresh token available' }
      }

      // QUERY 2: Get OAuth config based on credential type
      let tokenData: any

      if (credentialType === 'app-connection') {
        // Get ConnectionDefinition for app-connections
        const connDef = await db.query.ConnectionDefinition.findFirst({
          where: and(
            eq(schema.ConnectionDefinition.appId, appId),
            eq(schema.ConnectionDefinition.connectionType, 'oauth2-code')
          ),
          columns: {
            id: true,
            oauth2AccessTokenUrl: true,
            oauth2ClientId: true,
            oauth2ClientSecret: true,
            oauth2TokenRequestAuthMethod: true,
          },
        })

        if (!connDef || !connDef.oauth2AccessTokenUrl) {
          return { success: false, error: 'ConnectionDefinition not found' }
        }

        // Make refresh request to provider
        tokenData = await this.makeTokenRefreshRequest(
          connDef.oauth2AccessTokenUrl,
          connDef.oauth2ClientId!,
          connDef.oauth2ClientSecret!,
          oauth2Data.refreshToken,
          connDef.oauth2TokenRequestAuthMethod || 'request-body'
        )
      } else {
        // Workflow credentials - use CredentialTypeRegistry
        const oauth2Config = await this.getOAuth2ConfigForType(oauth2Data.metadata?.providerConfig)
        if (!oauth2Config) {
          return { success: false, error: 'OAuth2 config not found' }
        }

        tokenData = await this.makeTokenRefreshRequest(
          oauth2Config.tokenUrl,
          this.getSystemClientId(oauth2Config)!,
          this.getSystemClientSecret(oauth2Config)!,
          oauth2Data.refreshToken,
          'request-body'
        )
      }

      // Calculate new expiresAt
      const newExpiresAt = tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null

      // Update credential with new tokens
      const updatedData = {
        ...oauth2Data,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || oauth2Data.refreshToken,
        expiresAt: newExpiresAt?.toISOString(),
      }

      const encrypted = CredentialService.encrypt(updatedData as any)

      // QUERY 3: Single update with tokens + circuit breaker reset
      await db
        .update(schema.WorkflowCredentials)
        .set({
          encryptedData: encrypted,
          expiresAt: newExpiresAt,
          lastTokenRefreshAt: new Date(),
          consecutiveRefreshFailures: 0,
          lastRefreshFailureAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.WorkflowCredentials.id, credentialId))

      logger.info('Token refresh succeeded', {
        credentialId,
        credentialType,
        expiresAt: newExpiresAt,
        previousFailures: previousFailureCount,
      })

      return {
        success: true,
        expiresAt: newExpiresAt,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      logger.error('Token refresh failed', {
        credentialId,
        error: errorMessage,
      })

      // QUERY 3 (failure path): Update circuit breaker
      const newFailureCount = previousFailureCount + 1
      const circuitOpened = newFailureCount >= 5

      // Check if it's a permanent failure (invalid refresh token)
      const isPermanentFailure =
        errorMessage.includes('refresh token') && errorMessage.includes('invalid')

      await db
        .update(schema.WorkflowCredentials)
        .set({
          consecutiveRefreshFailures: isPermanentFailure ? 5 : newFailureCount,
          lastRefreshFailureAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.WorkflowCredentials.id, credentialId))

      return {
        success: false,
        error: errorMessage,
        newFailureCount,
        circuitOpened,
      }
    }
  }

  /**
   * Make token refresh request to OAuth provider
   * Extracted to reduce duplication
   */
  private async makeTokenRefreshRequest(
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    authMethod: string
  ): Promise<any> {
    const tokenRequestBody: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }

    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Handle basic-auth vs request-body
    if (authMethod === 'basic-auth') {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      headers['Authorization'] = `Basic ${basicAuth}`
      delete tokenRequestBody.client_id
      delete tokenRequestBody.client_secret
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(tokenRequestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
    }

    return response.json()
  }

  /**
   * Get OAuth2 config for credential type using credential registry
   */
  private async getOAuth2ConfigForType(credentialType: string): Promise<OAuth2Config | null> {
    try {
      logger.info('Loading OAuth2 config for credential type', { credentialType })

      // Get provider from the credential type registry
      const provider = this.credentialTypeRegistry.getProvider(credentialType)
      if (!provider) {
        logger.warn('No provider found for credential type', { credentialType })
        return null
      }

      // Extract OAuth2 config from the provider
      const oauth2Config = (provider as any).oauth2Config
      if (!oauth2Config) {
        logger.warn('Provider does not have OAuth2 config', {
          credentialType,
          providerName: provider.name,
        })
        return null
      }

      logger.info('OAuth2 config loaded successfully', {
        credentialType,
        provider: oauth2Config.providerName,
        hasConfig: !!oauth2Config,
      })

      return oauth2Config
    } catch (error) {
      logger.error('Failed to load OAuth2 config for credential type', {
        credentialType,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })
      return null
    }
  }
}
