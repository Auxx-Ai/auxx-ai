// packages/credentials/src/connections/oauth2-token-grants.ts
//
// OAuth2 token production for a credential — the two grants that mint/renew its access token:
// `refresh_token` (refresh an existing token) and `client_credentials` (mint server-side, no user
// or browser). Shared by the lazy resolve-on-use seam, the scheduled refresh job, and the connect
// surface. Lives beside `resolve-connection-definition.ts` because both grants resolve their
// provider config the same way (by ConnectionDefinition).

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { recordRefreshFailure, recordRefreshSuccess, revealSecrets, rotateSecrets } from '../store'
import { mergeConnectionVariables } from './interpolate-connection'
import {
  loadDefinitionForCredential,
  resolveOAuth2RefreshConfig,
} from './resolve-connection-definition'

const logger = createScopedLogger('oauth2-token-grants')

/** Circuit-breaker threshold mirrored from the store (a permanent failure jumps straight here). */
const CIRCUIT_OPEN_THRESHOLD = 5

/** Secret material stored for an OAuth2 workflow/app/mcp credential. */
interface OAuth2Secrets {
  accessToken?: string
  refreshToken?: string
  secret?: string
  /** Secret-flagged connection variables (encrypted alongside the tokens). */
  fields?: Record<string, string>
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
 * The token-refresh path shared by every credential kind (app, mcp, workflow, integration). All
 * persistence goes through the credential store; this module never touches `encryptedSecrets`
 * directly. OAuth *authorize/callback* now runs through the unified connection routes
 * (`/api/connections/[connectionDefinitionId]/oauth2/*`) — there is no kind-specific OAuth flow.
 */

/**
 * Refresh a credential's OAuth2 tokens. Loads the credential's ConnectionDefinition uniformly
 * (by connectionDefinitionId or owner — app/mcp/platform), interpolates the stored connection
 * variables, refreshes, then rotates the secrets and updates the circuit breaker through the
 * store. Used by both the tRPC endpoint and the scheduled refresh job.
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
    // Every credential — app, mcp, workflow, integration — now resolves its provider config the
    // same way: load the ConnectionDefinition (by connectionDefinitionId or owner), interpolate
    // the stored connection variables, and refresh. No `kind` branch, no registry lookup.
    const connDef = await loadDefinitionForCredential({
      connectionDefinitionId: record.connectionDefinitionId,
      appId: record.appId,
      mcpServerId: record.mcpServerId,
      type: record.type,
    })
    if (!connDef) {
      return { success: false, error: 'ConnectionDefinition not found' }
    }

    // Merged map: plain variables from metadata + secret-flagged ones from the
    // already-revealed secrets blob (secrets win on collision).
    const variables = mergeConnectionVariables(record.metadata, secrets)
    const oauth = resolveOAuth2RefreshConfig(connDef, variables)
    if (!oauth.accessTokenUrl) {
      return { success: false, error: 'ConnectionDefinition not found' }
    }

    // RFC 8707 resource indicator — the MCP spec requires it on every token request, and it
    // must match the value the authorize/code-exchange steps sent (the raw endpoint).
    let resource: string | undefined
    if (record.mcpServerId) {
      const server = await db.query.McpServer.findFirst({
        where: eq(schema.McpServer.id, record.mcpServerId),
        columns: { endpoint: true },
      })
      resource = server?.endpoint
    }

    // For MCP: re-stamped from `expires_in` after a successful refresh (TTLs drift server-side).
    const mcpConnDef = record.mcpServerId ? connDef : null

    const tokenData = await makeTokenRefreshRequest(
      // Providers with a dedicated refresh endpoint (the token URL rejects the refresh grant)
      // set oauth2RefreshUrl; everyone else refreshes against the access-token URL.
      oauth.refreshUrl || oauth.accessTokenUrl,
      oauth.clientId,
      oauth.clientSecret,
      secrets.refreshToken,
      oauth.authMethod,
      resource
    )

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

    // A revoked/invalid refresh token is permanent — no retry can recover it. `invalid_grant`
    // is the RFC 6749 §5.2 code every provider returns for a dead refresh token (revoked,
    // expired, or issued to a different client); the message check covers non-endpoint
    // failures that name the refresh token. Permanent jumps the breaker straight to the open
    // threshold AND flags the credential `requiresReauth` so the UI surfaces Reconnect.
    const isPermanentFailure =
      (error instanceof OAuth2TokenRequestError && error.oauthError === 'invalid_grant') ||
      (errorMessage.includes('refresh token') && errorMessage.includes('invalid'))
    await recordRefreshFailure(credentialId, organizationId, {
      permanent: isPermanentFailure,
      // Raw provider text → lastRefreshError (kept for every failure, transient included).
      authError: errorMessage,
      // Classified code → lastAuthError, but only when the token endpoint actually gave us one.
      authErrorType:
        error instanceof OAuth2TokenRequestError ? (error.oauthError ?? undefined) : undefined,
    })

    const newFailureCount = isPermanentFailure ? CIRCUIT_OPEN_THRESHOLD : previousFailureCount + 1
    return {
      success: false,
      error: errorMessage,
      newFailureCount,
      circuitOpened: newFailureCount >= CIRCUIT_OPEN_THRESHOLD,
    }
  }
}

/**
 * Mint a fresh access token for a `client-credentials` credential. There is no user, no browser,
 * and no refresh token: the org's `client_id`/`client_secret` (stored as secret connection
 * variables, resolved via the same `resolveOAuth2RefreshConfig` fallback as refresh) are POSTed
 * straight to the token endpoint. The minted token is rotated onto the credential as
 * `secrets.accessToken` — `secrets.fields` (the id/secret) are preserved by the spread — and
 * `expiresAt` is stamped. Shares the breaker + success/failure recording with the refresh path.
 * Called lazily by the runtime (on first use / near expiry) through `ensureFreshCredentialToken`.
 */
export async function mintClientCredentialToken(
  credentialId: string,
  organizationId: string
): Promise<RefreshTokensResult> {
  const revealed = await revealSecrets<OAuth2Secrets>(credentialId, organizationId)
  if (revealed.isErr()) {
    return { success: false, error: revealed.error.message }
  }

  const { record, secrets } = revealed.value
  const previousFailureCount = record.consecutiveRefreshFailures

  try {
    const connDef = await loadDefinitionForCredential({
      connectionDefinitionId: record.connectionDefinitionId,
      appId: record.appId,
      mcpServerId: record.mcpServerId,
      type: record.type,
    })
    if (!connDef) {
      return { success: false, error: 'ConnectionDefinition not found' }
    }

    const variables = mergeConnectionVariables(record.metadata, secrets)
    const oauth = resolveOAuth2RefreshConfig(connDef, variables)
    if (!oauth.accessTokenUrl) {
      return { success: false, error: 'ConnectionDefinition not found' }
    }

    const tokenData = await makeClientCredentialsRequest(
      oauth.accessTokenUrl,
      oauth.clientId,
      oauth.clientSecret,
      oauth.scopes,
      oauth.authMethod
    )

    const newExpiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null

    // No refreshToken written — client_credentials re-mints from the id/secret on expiry.
    const rotated = await rotateSecrets(credentialId, organizationId, {
      ...secrets,
      accessToken: tokenData.access_token,
    })
    if (rotated.isErr()) {
      return { success: false, error: rotated.error.message }
    }

    await recordRefreshSuccess(credentialId, organizationId, { expiresAt: newExpiresAt })

    logger.info('Client credentials token minted', {
      credentialId,
      kind: record.kind,
      expiresAt: newExpiresAt,
      previousFailures: previousFailureCount,
    })

    return { success: true, expiresAt: newExpiresAt }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Client credentials mint failed', { credentialId, error: errorMessage })

    // Never permanent — there is no refresh token to revoke; the next call re-mints from the
    // org's id/secret. Still record the reason, or a repeatedly failing mint is undiagnosable.
    await recordRefreshFailure(credentialId, organizationId, { authError: errorMessage })

    const newFailureCount = previousFailureCount + 1
    return {
      success: false,
      error: errorMessage,
      newFailureCount,
      circuitOpened: newFailureCount >= CIRCUIT_OPEN_THRESHOLD,
    }
  }
}

/** Token response shape shared by the refresh and client-credentials grants. */
interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

/**
 * A non-2xx response from an OAuth2 token endpoint, carrying the RFC 6749 §5.2 error code
 * parsed from the response body (`invalid_grant`, `invalid_client`, …) so callers classify
 * failures structurally instead of substring-matching the message.
 */
export class OAuth2TokenRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly oauthError: string | null
  ) {
    super(message)
    this.name = 'OAuth2TokenRequestError'
  }
}

/** Extract the RFC 6749 `error` code from a token-endpoint error body, tolerating non-JSON. */
function parseOAuthErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    return typeof parsed?.error === 'string' ? parsed.error : null
  } catch {
    return null
  }
}

/**
 * POST a form-encoded OAuth2 token request, applying `basic-auth` vs `request-body` client
 * authentication uniformly. Shared by the refresh-token and client-credentials grants so the two
 * never drift on header/auth handling. `body` carries the grant-specific params; the client
 * id/secret are placed in the body (request-body) or the `Authorization` header (basic-auth).
 */
async function postOAuth2TokenRequest(
  tokenUrl: string,
  body: Record<string, string>,
  clientId: string,
  clientSecret: string | null | undefined,
  authMethod: string,
  failureLabel: string
): Promise<TokenResponse> {
  const tokenRequestBody: Record<string, string> = {
    ...body,
    client_id: clientId,
    // Public clients (e.g. DCR-minted MCP clients, PKCE-only) have no secret — omit the field
    // rather than sending an empty value some ASes reject.
    ...(clientSecret ? { client_secret: clientSecret } : {}),
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
    throw new OAuth2TokenRequestError(
      `${failureLabel}: ${response.status} ${errorText}`,
      response.status,
      parseOAuthErrorCode(errorText)
    )
  }

  return response.json()
}

/** Make a refresh-token request to the provider, handling basic-auth vs request-body. */
async function makeTokenRefreshRequest(
  tokenUrl: string,
  clientId: string,
  clientSecret: string | null | undefined,
  refreshToken: string,
  authMethod: string,
  resource?: string
): Promise<TokenResponse> {
  return postOAuth2TokenRequest(
    tokenUrl,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...(resource ? { resource } : {}),
    },
    clientId,
    clientSecret,
    authMethod,
    'Token refresh failed'
  )
}

/**
 * Make a `client_credentials` token request — the no-user, no-browser grant: POST the client
 * id/secret straight to the token endpoint to mint a short-lived bearer (no refresh token).
 * `basic-auth` vs `request-body` is handled identically to {@link makeTokenRefreshRequest}.
 */
export async function makeClientCredentialsRequest(
  tokenUrl: string,
  clientId: string,
  clientSecret: string | null | undefined,
  scopes: string[],
  authMethod: string
): Promise<TokenResponse> {
  return postOAuth2TokenRequest(
    tokenUrl,
    {
      grant_type: 'client_credentials',
      // Scope is optional per RFC 6749 §4.4.2 — omit the param entirely when none are configured.
      ...(scopes.length > 0 ? { scope: scopes.join(' ') } : {}),
    },
    clientId,
    clientSecret,
    authMethod,
    'Client credentials grant failed'
  )
}
