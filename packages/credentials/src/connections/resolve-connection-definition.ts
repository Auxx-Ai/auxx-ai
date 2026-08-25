// packages/credentials/src/connections/resolve-connection-definition.ts
// Load the ConnectionDefinition backing a credential (any owner) and resolve its
// OAuth2 refresh config. This is the single lookup that replaces the old
// `kind`-branch in refreshCredentialTokens — every credential resolves its
// definition the same way, by connectionDefinitionId or by owner.

import { type AuthApply, type ConnectionVariable, database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { interpolateConnectionFields } from './interpolate-connection'

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
 * Decide how a connection may obtain its OAuth client (§3.1). Two signals:
 *  - `requiresOwnClient` — BYO client id/secret are MANDATORY. Fires only for
 *    `no-platform-client`: the def has no platform client (its env var was unset at
 *    seed time, so the column is blank); a column null-check IS the env-presence check.
 *  - `ownClientOptional` — BYO is OFFERED as an alternative but not required. Fires for
 *    `pending-approval`: a platform client exists but its app is not yet Google-verified
 *    (`platformClientApproved=false`, e.g. Google restricted scopes). The user may try
 *    the platform login (Google shows an "unverified app" warning and, for restricted
 *    scopes, only lets test users through) OR supply their own OAuth client.
 *
 * The gate decides *required / optional / neither*; `resolveOAuth2Client` decides *which
 * client is used* (per-credential vars win over the platform client). No per-provider
 * code — works for any OAuth2 def.
 */
export function resolveOwnClientRequirement(def: {
  oauth2ClientId: string | null
  oauth2ClientSecret: string | null
  platformClientApproved: boolean
}): {
  requiresOwnClient: boolean
  ownClientOptional: boolean
  reason: 'no-platform-client' | 'pending-approval' | null
} {
  const platformClientPresent = !!def.oauth2ClientId && !!def.oauth2ClientSecret
  if (!platformClientPresent)
    return { requiresOwnClient: true, ownClientOptional: false, reason: 'no-platform-client' }
  if (!def.platformClientApproved)
    return { requiresOwnClient: false, ownClientOptional: true, reason: 'pending-approval' }
  return { requiresOwnClient: false, ownClientOptional: false, reason: null }
}

/** The BYO OAuth client variable keys (§3.2) — provider-agnostic. */
export const BYO_CLIENT_KEYS = new Set(['clientId', 'clientSecret'])

/**
 * Canonical BYO client var descriptors, injected into the connect form when a connection
 * offers/requires an own client and the def didn't declare them itself. Keeps every
 * OAuth2 connection (platform provider, channel, or app) uniform — a provider/app opts in
 * purely via `platformClientApproved`, without hand-authoring these two variables.
 */
export const BYO_CLIENT_VARS: ConnectionVariable[] = [
  { key: 'clientId', label: 'Client ID', placeholder: 'Your OAuth client id' },
  {
    key: 'clientSecret',
    label: 'Client Secret',
    secret: true,
    placeholder: 'Your OAuth client secret',
  },
]

/**
 * Shape an OAuth2 connection's connect-form variables per the own-client gate (§3.1),
 * provider-agnostic:
 *  - `requiresOwnClient` → BYO client fields present + required (no platform client).
 *  - `ownClientOptional` → BYO client fields present + optional (platform client pending
 *    verification; user may use it OR their own).
 *  - neither            → BYO client fields removed (one-click platform connect).
 * BYO fields are injected when the def didn't declare them. Non-`oauth2-code` defs pass
 * through untouched.
 */
export function gateConnectionVariables(
  connectionType: string,
  vars: ConnectionVariable[],
  gate: { requiresOwnClient: boolean; ownClientOptional: boolean }
): ConnectionVariable[] {
  if (connectionType !== 'oauth2-code') return vars
  if (gate.requiresOwnClient || gate.ownClientOptional) {
    const hasByo = vars.some((v) => BYO_CLIENT_KEYS.has(v.key))
    const base = hasByo ? vars : [...vars, ...BYO_CLIENT_VARS]
    return base.map((v) =>
      BYO_CLIENT_KEYS.has(v.key) ? { ...v, required: gate.requiresOwnClient } : v
    )
  }
  return vars.filter((v) => !BYO_CLIENT_KEYS.has(v.key))
}

/**
 * The variables a connect attempt may actually supply: the definition's stored
 * `connectionVariables` **union** whatever the own-client gate injects.
 *
 * The BYO client descriptors are never persisted on a definition — `gateConnectionVariables`
 * adds them at read time for the connect UI. A server route that builds its allowlist (or
 * its secret-flag set) from the raw stored column therefore cannot see `clientId` /
 * `clientSecret` at all, silently drops them off the query string, and falls back to the
 * platform client. Routing every such read through this helper keeps the UI projection and
 * the server allowlist the same function by construction.
 *
 * See `plans/connections/byo-oauth-client-runtime-gap.md` §2.
 */
export function effectiveConnectionVariables(
  def: { connectionType: string; connectionVariables?: ConnectionVariable[] | null },
  gate: { requiresOwnClient: boolean; ownClientOptional: boolean }
): ConnectionVariable[] {
  return gateConnectionVariables(def.connectionType, def.connectionVariables ?? [], gate)
}

/** Variable keys that must always be encrypted, whether or not the def declares them. */
const ALWAYS_SECRET_KEYS = new Set(BYO_CLIENT_VARS.filter((v) => v.secret).map((v) => v.key))

/**
 * Split a supplied variable map into encrypt-me and plaintext-ok halves.
 *
 * Secrecy is a property of the **key**, not of whether this particular definition happened
 * to declare it. `clientSecret` carries `secret: true` only on the injected
 * {@link BYO_CLIENT_VARS} descriptors, so a callback deriving its secret set from the stored
 * column alone would persist a bring-your-own client secret in plaintext metadata — which is
 * also shipped to the browser by `apps.listConnections`.
 */
export function splitConnectionVariablesBySecrecy(
  def: { connectionVariables?: ConnectionVariable[] | null },
  variables: Record<string, string>
): { secretFields: Record<string, string>; plainVariables: Record<string, string> } {
  const declaredSecret = new Set(
    (def.connectionVariables ?? []).filter((v) => v.secret).map((v) => v.key)
  )
  const secretFields: Record<string, string> = {}
  const plainVariables: Record<string, string> = {}
  for (const [key, value] of Object.entries(variables)) {
    if (declaredSecret.has(key) || ALWAYS_SECRET_KEYS.has(key)) secretFields[key] = value
    else plainVariables[key] = value
  }
  return { secretFields, plainVariables }
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
