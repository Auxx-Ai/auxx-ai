// packages/lib/src/workflows/oauth2-workflow.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { CredentialTypeRegistry, configService } from '@auxx/credentials'
import {
  insertCredential,
  recordRefreshFailure,
  recordRefreshSuccess,
  revealSecrets,
  rotateSecrets,
} from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import { URLTemplateService } from '@auxx/workflow-nodes/server'
import type {
  OAuth2CallbackResult,
  OAuth2Config,
  OAuth2InitiationResponse,
  OAuth2State,
  OAuth2Tokens,
} from '@auxx/workflow-nodes/types'
import { and, eq } from 'drizzle-orm'

const logger = createScopedLogger('oauth2-workflow')

/** Circuit-breaker threshold mirrored from the store (a permanent failure jumps straight here). */
const CIRCUIT_OPEN_THRESHOLD = 5

/** Secret material stored for an OAuth2 workflow/app/mcp credential. */
interface OAuth2Secrets {
  accessToken?: string
  refreshToken?: string
  secret?: string
}

/** Result of a token refresh attempt (shared by the tRPC endpoint and the refresh job). */
export interface RefreshTokensResult {
  success: boolean
  expiresAt?: Date | null
  error?: string
  newFailureCount?: number
  circuitOpened?: boolean
}

/**
 * Generic OAuth2 support for workflow credentials, plus the token-refresh path shared by
 * app/mcp/workflow credentials. All persistence goes through the credential store; this module
 * never touches `encryptedSecrets` directly.
 */

// Lazily-constructed registry of workflow credential providers (for OAuth2 config lookup).
let credentialTypeRegistry: CredentialTypeRegistry | null = null
function getCredentialTypeRegistry(): CredentialTypeRegistry {
  if (!credentialTypeRegistry) credentialTypeRegistry = new CredentialTypeRegistry()
  return credentialTypeRegistry
}

/**
 * Initiate an OAuth2 flow for a workflow credential type. Pure URL/state building — no persistence.
 */
export async function initiateOAuth(
  oauth2Config: OAuth2Config,
  organizationId: string,
  userId: string,
  credentialType: string,
  credentialName: string,
  credentialData?: Record<string, any>
): Promise<OAuth2InitiationResponse> {
  const clientId = getSystemClientId(oauth2Config)
  if (!clientId) {
    throw new Error(`System client ID not configured for ${oauth2Config.providerName}`)
  }

  const state: OAuth2State = {
    organizationId,
    userId,
    credentialType,
    credentialName,
    nonce: generateNonce(),
    timestamp: Date.now(),
  }
  const encodedState = encodeState(state)
  const authUrl = buildAuthUrl(oauth2Config, clientId, encodedState, credentialData)

  logger.info('OAuth2 flow initiated', {
    provider: oauth2Config.providerName,
    organizationId,
    userId,
    credentialType,
  })

  return { authUrl, state: encodedState }
}

/**
 * Handle an OAuth2 callback: exchange the code for tokens, fetch user info, and persist the
 * credential as `kind: 'workflow'` via the store (secrets split from plaintext metadata).
 */
export async function handleOAuth2Callback(
  code: string,
  stateParam: string
): Promise<OAuth2CallbackResult> {
  try {
    const state = decodeState(stateParam)
    validateState(state)

    const oauth2Config = await getOAuth2ConfigForType(state.credentialType)
    if (!oauth2Config) {
      throw new Error(`OAuth2 config not found for credential type: ${state.credentialType}`)
    }

    const clientId = getSystemClientId(oauth2Config)
    const clientSecret = getSystemClientSecret(oauth2Config)
    if (!clientId || !clientSecret) {
      throw new Error(
        `Missing OAuth2 environment variables: ${oauth2Config.systemClientIdEnv}, ${oauth2Config.systemClientSecretEnv}`
      )
    }

    const tokens = await exchangeCodeForTokens(oauth2Config, code, undefined)
    const userInfo = await getUserInfo(oauth2Config, tokens)

    const created = await insertCredential({
      organizationId: state.organizationId,
      createdById: state.userId,
      kind: 'workflow',
      type: state.credentialType,
      userId: state.userId,
      name: state.credentialName,
      secrets: {
        ...(tokens.accessToken !== undefined && { accessToken: tokens.accessToken }),
        ...(tokens.refreshToken !== undefined && { refreshToken: tokens.refreshToken }),
      },
      metadata: {
        provider: oauth2Config.providerName,
        scopes: tokens.scopes || oauth2Config.scopes,
        tokenType: tokens.tokenType ?? 'Bearer',
        email: userInfo.email,
        userId: userInfo.userId,
        providerConfig: state.credentialType,
        ...tokens.metadata,
      },
      expiresAt: tokens.expiresAt ?? null,
    })

    if (created.isErr()) {
      throw new Error(created.error.message)
    }

    logger.info('OAuth2 credential created successfully', {
      credentialId: created.value.id,
      provider: oauth2Config.providerName,
      organizationId: state.organizationId,
      userEmail: userInfo.email,
    })

    return { success: true, credentialId: created.value.id, userInfo }
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
 * Refresh a credential's OAuth2 tokens. Routes by `kind` (app/mcp → ConnectionDefinition via
 * appId/mcpServerId; workflow → CredentialTypeRegistry via `metadata.providerConfig`), then
 * rotates the secrets and updates the circuit breaker through the store. Used by both the tRPC
 * endpoint and the scheduled refresh job.
 */
export async function refreshCredentialTokens(
  credentialId: string,
  organizationId: string
): Promise<RefreshTokensResult> {
  const revealed = await revealSecrets<OAuth2Secrets>(credentialId, organizationId)
  if (revealed.isErr()) {
    return { success: false, error: revealed.error.message }
  }

  const { record, secrets } = revealed.value
  const previousFailureCount = record.consecutiveRefreshFailures

  if (!secrets.refreshToken) {
    return { success: false, error: 'No refresh token available' }
  }

  try {
    let tokenData: {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
    // For MCP: re-stamped from `expires_in` after a successful refresh (TTLs drift server-side).
    let mcpConnDef: { id: string; oauth2RefreshTokenIntervalSeconds: number | null } | null = null

    if (record.kind === 'app' || record.kind === 'mcp') {
      // App- and mcp-connections share the oauth2 columns + circuit-breaker path; only the owner
      // key differs. Connection variables (e.g. Shopify's shop subdomain) live in metadata.
      const ownerFilter =
        record.kind === 'mcp'
          ? eq(schema.ConnectionDefinition.mcpServerId, record.mcpServerId ?? '')
          : eq(schema.ConnectionDefinition.appId, record.appId ?? '')
      const connDef = await db.query.ConnectionDefinition.findFirst({
        where: and(ownerFilter, eq(schema.ConnectionDefinition.connectionType, 'oauth2-code')),
        columns: {
          id: true,
          oauth2AuthorizeUrl: true,
          oauth2AccessTokenUrl: true,
          oauth2ClientId: true,
          oauth2ClientSecret: true,
          oauth2TokenRequestAuthMethod: true,
          oauth2RefreshTokenIntervalSeconds: true,
        },
      })

      if (!connDef || !connDef.oauth2AccessTokenUrl) {
        return { success: false, error: 'ConnectionDefinition not found' }
      }

      const variables = (record.metadata.connectionVariables as Record<string, string>) ?? {}
      const resolved = interpolateConnectionFields(connDef, variables)

      // RFC 8707 resource indicator — the MCP spec requires it on every token request, and it
      // must match the value the authorize/code-exchange steps sent (the raw endpoint).
      let resource: string | undefined
      if (record.kind === 'mcp' && record.mcpServerId) {
        const server = await db.query.McpServer.findFirst({
          where: eq(schema.McpServer.id, record.mcpServerId),
          columns: { endpoint: true },
        })
        resource = server?.endpoint
      }

      if (record.kind === 'mcp') mcpConnDef = connDef

      tokenData = await makeTokenRefreshRequest(
        resolved.accessTokenUrl,
        resolved.clientId,
        resolved.clientSecret,
        secrets.refreshToken,
        connDef.oauth2TokenRequestAuthMethod || 'request-body',
        resource
      )
    } else {
      // Workflow credentials — resolve the OAuth2 config from the registry.
      const oauth2Config = await getOAuth2ConfigForType(record.metadata.providerConfig as string)
      if (!oauth2Config) {
        return { success: false, error: 'OAuth2 config not found' }
      }

      tokenData = await makeTokenRefreshRequest(
        oauth2Config.tokenUrl,
        getSystemClientId(oauth2Config)!,
        getSystemClientSecret(oauth2Config)!,
        secrets.refreshToken,
        'request-body'
      )
    }

    const newExpiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null

    const rotated = await rotateSecrets(credentialId, organizationId, {
      ...secrets,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || secrets.refreshToken,
    })
    if (rotated.isErr()) {
      return { success: false, error: rotated.error.message }
    }

    // Reset the breaker + stamp lastRefreshAt + new expiry.
    await recordRefreshSuccess(credentialId, organizationId, { expiresAt: newExpiresAt })

    // Keep the scanner's cadence tracking the actual MCP token TTL (30-min floor — the 15-min
    // scanner can't keep shorter tokens warm; the lazy/401 paths carry those).
    if (mcpConnDef && tokenData.expires_in) {
      const intervalSeconds = Math.max(tokenData.expires_in, 1800)
      if (intervalSeconds !== mcpConnDef.oauth2RefreshTokenIntervalSeconds) {
        await db
          .update(schema.ConnectionDefinition)
          .set({ oauth2RefreshTokenIntervalSeconds: intervalSeconds })
          .where(eq(schema.ConnectionDefinition.id, mcpConnDef.id))
      }
    }

    logger.info('Token refresh succeeded', {
      credentialId,
      kind: record.kind,
      expiresAt: newExpiresAt,
      previousFailures: previousFailureCount,
    })

    return { success: true, expiresAt: newExpiresAt }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Token refresh failed', { credentialId, error: errorMessage })

    // An invalid refresh token is permanent — jump the breaker straight to the open threshold.
    const isPermanentFailure =
      errorMessage.includes('refresh token') && errorMessage.includes('invalid')
    await recordRefreshFailure(credentialId, organizationId, { permanent: isPermanentFailure })

    const newFailureCount = isPermanentFailure ? CIRCUIT_OPEN_THRESHOLD : previousFailureCount + 1
    return {
      success: false,
      error: errorMessage,
      newFailureCount,
      circuitOpened: newFailureCount >= CIRCUIT_OPEN_THRESHOLD,
    }
  }
}

// === Internal helpers ===

function getSystemClientId(oauth2Config: OAuth2Config): string | null {
  return configService.get<string>(oauth2Config.systemClientIdEnv) || null
}

function getSystemClientSecret(oauth2Config: OAuth2Config): string | null {
  return configService.get<string>(oauth2Config.systemClientSecretEnv) || null
}

function buildAuthUrl(
  oauth2Config: OAuth2Config,
  clientId: string,
  state: string,
  credentialData?: Record<string, any>
): string {
  const authUrl = oauth2Config.urlTransforms?.authUrl
    ? URLTemplateService.replaceTemplate(
        oauth2Config.authUrl,
        credentialData || {},
        oauth2Config.urlTransforms.authUrl
      )
    : oauth2Config.authUrl

  if (!URLTemplateService.isFullyResolved(authUrl)) {
    logger.warn('Auth URL has unresolved placeholders', {
      provider: oauth2Config.providerName,
      placeholders: URLTemplateService.getPlaceholders(authUrl),
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

async function exchangeCodeForTokens(
  oauth2Config: OAuth2Config,
  code: string,
  credentialData?: Record<string, any>
): Promise<OAuth2Tokens> {
  const clientId = getSystemClientId(oauth2Config)
  const clientSecret = getSystemClientSecret(oauth2Config)
  if (!clientId || !clientSecret) {
    throw new Error('System OAuth2 credentials not configured')
  }

  const tokenUrl = oauth2Config.urlTransforms?.tokenUrl
    ? URLTemplateService.replaceTemplate(
        oauth2Config.tokenUrl,
        credentialData || {},
        oauth2Config.urlTransforms.tokenUrl
      )
    : oauth2Config.tokenUrl

  if (!URLTemplateService.isFullyResolved(tokenUrl)) {
    logger.warn('Token URL has unresolved placeholders', {
      provider: oauth2Config.providerName,
      placeholders: URLTemplateService.getPlaceholders(tokenUrl),
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

async function getUserInfo(
  oauth2Config: OAuth2Config,
  tokens: OAuth2Tokens
): Promise<{ email?: string; userId?: string; name?: string }> {
  const userInfoEndpoints: Record<string, string> = {
    google: 'https://www.googleapis.com/oauth2/v2/userinfo',
    microsoft: 'https://graph.microsoft.com/v1.0/me',
    github: 'https://api.github.com/user',
  }

  const endpoint = userInfoEndpoints[oauth2Config.providerName]
  if (!endpoint) return {}

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

function generateNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function encodeState(state: OAuth2State): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url')
}

function decodeState(stateParam: string): OAuth2State {
  try {
    return JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf-8'))
  } catch {
    throw new Error('Invalid state parameter')
  }
}

function validateState(state: OAuth2State): void {
  const maxAge = 10 * 60 * 1000 // 10 minutes
  if (Date.now() - state.timestamp > maxAge) {
    throw new Error('OAuth state expired')
  }
  if (!state.organizationId || !state.userId || !state.credentialType || !state.nonce) {
    throw new Error('Invalid OAuth state')
  }
}

/** Make a refresh-token request to the provider, handling basic-auth vs request-body. */
async function makeTokenRefreshRequest(
  tokenUrl: string,
  clientId: string,
  clientSecret: string | null | undefined,
  refreshToken: string,
  authMethod: string,
  resource?: string
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const tokenRequestBody: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    // Public clients (e.g. DCR-minted MCP clients, PKCE-only) have no secret — omit the field
    // rather than sending an empty value some ASes reject.
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    ...(resource ? { resource } : {}),
  }

  const headers: Record<string, string> = {
    // RFC 6749 §4.1.3 requires form-encoded bodies
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  if (authMethod === 'basic-auth') {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret ?? ''}`).toString('base64')
    headers.Authorization = `Basic ${basicAuth}`
    delete tokenRequestBody.client_id
    delete tokenRequestBody.client_secret
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams(tokenRequestBody).toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
  }

  return response.json()
}

/** Resolve the OAuth2 config for a workflow credential type via the credential registry. */
async function getOAuth2ConfigForType(credentialType: string): Promise<OAuth2Config | null> {
  try {
    const provider = getCredentialTypeRegistry().getProvider(credentialType)
    if (!provider) {
      logger.warn('No provider found for credential type', { credentialType })
      return null
    }

    const oauth2Config = (provider as any).oauth2Config
    if (!oauth2Config) {
      logger.warn('Provider does not have OAuth2 config', {
        credentialType,
        providerName: provider.name,
      })
      return null
    }

    return oauth2Config
  } catch (error) {
    logger.error('Failed to load OAuth2 config for credential type', {
      credentialType,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}
