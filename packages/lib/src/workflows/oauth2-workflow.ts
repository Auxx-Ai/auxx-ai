// packages/lib/src/workflows/oauth2-workflow.ts

import {
  recordRefreshFailure,
  recordRefreshSuccess,
  revealSecrets,
  rotateSecrets,
} from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { mergeConnectionVariables } from '@auxx/services/app-connections'
import { eq } from 'drizzle-orm'
import {
  loadDefinitionForCredential,
  resolveOAuth2RefreshConfig,
} from '../connections/resolve-connection-definition'

const logger = createScopedLogger('oauth2-workflow')

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
