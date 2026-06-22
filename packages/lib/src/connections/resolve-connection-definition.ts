// packages/lib/src/connections/resolve-connection-definition.ts
// Load the ConnectionDefinition backing a credential (any owner) and resolve its
// OAuth2 refresh config. This is the single lookup that replaces the old
// `kind`-branch in refreshCredentialTokens — every credential resolves its
// definition the same way, by connectionDefinitionId or by owner.

import { type AuthApply, database as db, schema } from '@auxx/database'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import { and, eq } from 'drizzle-orm'

/** Columns the refresh + resolve paths need off a ConnectionDefinition. */
export interface ConnectionDefinitionForRefresh {
  id: string
  connectionType: string
  authApply: AuthApply | null
  oauth2AuthorizeUrl: string | null
  oauth2AccessTokenUrl: string | null
  oauth2RefreshUrl: string | null
  oauth2Scopes: string[] | null
  oauth2ClientId: string | null
  oauth2ClientSecret: string | null
  oauth2TokenRequestAuthMethod: string | null
  oauth2RefreshTokenIntervalSeconds: number | null
}

/** The owner/link fields read off a credential to find its definition. */
export interface CredentialOwner {
  connectionDefinitionId?: string | null
  appId?: string | null
  mcpServerId?: string | null
  /** Platform built-in provider key (= Credential.type for workflow/integration creds). */
  type?: string | null
}

const REFRESH_COLUMNS = {
  id: true,
  connectionType: true,
  authApply: true,
  oauth2AuthorizeUrl: true,
  oauth2AccessTokenUrl: true,
  oauth2RefreshUrl: true,
  oauth2Scopes: true,
  oauth2ClientId: true,
  oauth2ClientSecret: true,
  oauth2TokenRequestAuthMethod: true,
  oauth2RefreshTokenIntervalSeconds: true,
} as const

/**
 * Find the ConnectionDefinition for a credential by, in order: its direct
 * `connectionDefinitionId` FK, its app/mcp owner, then its platform `providerKey`
 * (= `type`). Returns null when none matches.
 */
export async function loadDefinitionForCredential(
  owner: CredentialOwner
): Promise<ConnectionDefinitionForRefresh | null> {
  if (owner.connectionDefinitionId) {
    const def = await db.query.ConnectionDefinition.findFirst({
      where: eq(schema.ConnectionDefinition.id, owner.connectionDefinitionId),
      columns: REFRESH_COLUMNS,
    })
    if (def) return def
  }

  if (owner.appId) {
    // Defensive fallback for legacy app creds whose FK predates the §4 always-write. With
    // multi-method apps this can only disambiguate by picking the (single) oauth2-code method;
    // once every app cred carries its FK (pre-launch reseed), this branch is dead for apps.
    return (
      (await db.query.ConnectionDefinition.findFirst({
        where: and(
          eq(schema.ConnectionDefinition.appId, owner.appId),
          eq(schema.ConnectionDefinition.connectionType, 'oauth2-code')
        ),
        columns: REFRESH_COLUMNS,
      })) ?? null
    )
  }

  if (owner.mcpServerId) {
    return (
      (await db.query.ConnectionDefinition.findFirst({
        where: eq(schema.ConnectionDefinition.mcpServerId, owner.mcpServerId),
        columns: REFRESH_COLUMNS,
      })) ?? null
    )
  }

  if (owner.type) {
    return (
      (await db.query.ConnectionDefinition.findFirst({
        where: eq(schema.ConnectionDefinition.providerKey, owner.type),
        columns: REFRESH_COLUMNS,
      })) ?? null
    )
  }

  return null
}

/**
 * Decide whether a connection MUST bring its own OAuth client, and why (§3.1).
 * "Force BYO" fires for either reason, collapsed into one signal:
 *  - `no-platform-client` — the def has no platform client (its env var was unset at
 *    seed time, so the column is blank); a column null-check IS the env-presence check.
 *  - `pending-approval`   — a platform client exists but its app is not yet verified
 *    (`platformClientApproved=false`, e.g. Google restricted scopes).
 *
 * The gate decides *required vs optional*; `resolveOAuth2Client` decides *which client
 * is used*. No per-provider code — works for any OAuth2 def.
 */
export function resolveOwnClientRequirement(def: {
  oauth2ClientId: string | null
  oauth2ClientSecret: string | null
  platformClientApproved: boolean
}): {
  requiresOwnClient: boolean
  reason: 'no-platform-client' | 'pending-approval' | null
} {
  const platformClientPresent = !!def.oauth2ClientId && !!def.oauth2ClientSecret
  if (!platformClientPresent) return { requiresOwnClient: true, reason: 'no-platform-client' }
  if (!def.platformClientApproved) return { requiresOwnClient: true, reason: 'pending-approval' }
  return { requiresOwnClient: false, reason: null }
}

/**
 * Resolve which OAuth client id/secret a connection uses (§3.2). Precedence:
 * **per-credential `clientId`/`clientSecret` vars win when present, else the def's
 * platform client** (decrypted + interpolated by `interpolateConnectionFields`). This is
 * the single home of the BYO-client override — called from authorize, callback, and
 * refresh so all three agree on the client.
 */
export function resolveOAuth2Client(
  def: {
    oauth2ClientId: string | null
    oauth2ClientSecret: string | null
    oauth2AuthorizeUrl?: string | null
    oauth2AccessTokenUrl?: string | null
    oauth2RefreshUrl?: string | null
  },
  variables: Record<string, string>
): { clientId: string; clientSecret: string } {
  const resolved = interpolateConnectionFields(
    {
      oauth2AuthorizeUrl: def.oauth2AuthorizeUrl ?? null,
      oauth2AccessTokenUrl: def.oauth2AccessTokenUrl ?? null,
      oauth2RefreshUrl: def.oauth2RefreshUrl ?? null,
      oauth2ClientId: def.oauth2ClientId,
      oauth2ClientSecret: def.oauth2ClientSecret,
    },
    variables
  )
  return {
    clientId: variables.clientId || resolved.clientId || '',
    clientSecret: variables.clientSecret || resolved.clientSecret || '',
  }
}

/**
 * Resolve the concrete OAuth2 token-refresh config for a definition + a credential's
 * connection variables. Client id/secret follow the §3.2 precedence (per-credential
 * vars win), and the §9.1 bring-your-own-OAuth2 URL fallback fills blank URLs from the
 * credential-stored variables (the generic `oAuth2Api` row).
 */
export function resolveOAuth2RefreshConfig(
  def: ConnectionDefinitionForRefresh,
  variables: Record<string, string>
): {
  accessTokenUrl: string
  refreshUrl: string
  clientId: string
  clientSecret: string
  authMethod: string
  scopes: string[]
} {
  const resolved = interpolateConnectionFields(def, variables)
  const { clientId, clientSecret } = resolveOAuth2Client(def, variables)

  // Bring-your-own-OAuth2 URL fallback (§9.1): the generic provider stores its URLs
  // per-credential, so fill blanks from the connection variables.
  const accessTokenUrl = resolved.accessTokenUrl || variables.accessTokenUrl || ''
  const refreshUrl = resolved.refreshUrl || variables.refreshUrl || ''

  return {
    accessTokenUrl,
    refreshUrl,
    clientId,
    clientSecret,
    authMethod: def.oauth2TokenRequestAuthMethod || 'request-body',
    scopes: def.oauth2Scopes ?? [],
  }
}
