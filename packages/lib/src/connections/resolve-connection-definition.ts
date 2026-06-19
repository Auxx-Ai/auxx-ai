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
 * Resolve the concrete OAuth2 token-refresh config for a definition + a credential's
 * connection variables. Applies the §9.1 bring-your-own-OAuth2 fallback: when the
 * definition's URLs / client creds are blank (the generic `oAuth2Api` row), they are
 * taken from the credential-stored variables instead.
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
} {
  const resolved = interpolateConnectionFields(def, variables)

  // Bring-your-own-OAuth2 fallback (§9.1): the generic provider stores its URLs and
  // client creds per-credential, so fill blanks from the connection variables.
  const accessTokenUrl = resolved.accessTokenUrl || variables.accessTokenUrl || ''
  const refreshUrl = resolved.refreshUrl || variables.refreshUrl || ''
  const clientId = resolved.clientId || variables.clientId || ''
  const clientSecret = resolved.clientSecret || variables.clientSecret || ''

  return {
    accessTokenUrl,
    refreshUrl,
    clientId,
    clientSecret,
    authMethod: def.oauth2TokenRequestAuthMethod || 'request-body',
  }
}
