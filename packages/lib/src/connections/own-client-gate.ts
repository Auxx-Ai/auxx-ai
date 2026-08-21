// packages/lib/src/connections/own-client-gate.ts
// Org-aware wrapper around `resolveOwnClientRequirement`. The pure gate in
// `@auxx/credentials` answers "does this DEFINITION's platform client work?"; this
// answers "may THIS ORG bring its own OAuth client?" by folding in the
// `byoOAuthClient` feature. Every surface that renders or enforces the BYO choice
// resolves it here so the dialog, the provider list, and the authorize route agree.

import { resolveOwnClientRequirement } from '@auxx/credentials/connections'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'

/**
 * Why a connection is offering (or demanding) its own OAuth client.
 *
 * - `no-platform-client` — the def has no platform client at all; BYO is mandatory.
 * - `pending-approval` — a platform client exists but its app is not yet verified;
 *   BYO is offered alongside it, and the surface warns about the provider's
 *   unverified-app screen.
 * - `byo-entitled` — the platform client is fine and verified; BYO is offered purely
 *   because the org holds `FeatureKey.byoOAuthClient`. No unverified-app warning.
 */
export type OwnClientReason = 'no-platform-client' | 'pending-approval' | 'byo-entitled' | null

export interface OwnClientGate {
  /** BYO client id/secret are mandatory — there is no usable platform client. */
  requiresOwnClient: boolean
  /** BYO is offered as an alternative to the platform client, but not required. */
  ownClientOptional: boolean
  reason: OwnClientReason
}

/** The definition columns the gate reads. */
export interface OwnClientGateDefinition {
  oauth2ClientId: string | null
  oauth2ClientSecret: string | null
  platformClientApproved: boolean
}

/** A gate that offers nothing — for non-OAuth defs, which have no platform client concept. */
export const NO_OWN_CLIENT_GATE: OwnClientGate = {
  requiresOwnClient: false,
  ownClientOptional: false,
  reason: null,
}

/**
 * Resolve the own-client gate for one organization.
 *
 * The verification state decides first and is never overridden: a def with no platform
 * client still *requires* BYO regardless of the feature (otherwise the org could not
 * connect at all), and a pending-approval def already offers BYO with the warning copy
 * the surfaces key off. The feature only adds the third case — a verified platform
 * client whose org is nonetheless allowed to substitute its own app.
 *
 * `hasAccess` reads a missing key as `false`, so an org whose plan row predates this
 * feature stays on the platform-only flow until the key is granted.
 */
export async function resolveOwnClientGateForOrg(
  organizationId: string,
  def: OwnClientGateDefinition
): Promise<OwnClientGate> {
  const base = resolveOwnClientRequirement(def)
  if (base.requiresOwnClient || base.ownClientOptional) return base

  const entitled = await new FeaturePermissionService().hasAccess(
    organizationId,
    FeatureKey.byoOAuthClient
  )
  if (!entitled) return base

  return { requiresOwnClient: false, ownClientOptional: true, reason: 'byo-entitled' }
}

/**
 * Drop caller-supplied BYO client credentials when the gate offers no BYO path.
 *
 * The connect dialog hides the fields, but the authorize route takes them off the query
 * string — so without this an org could opt itself into a different OAuth client simply
 * by appending `var_clientId`/`var_clientSecret`. Values that were already **stored** on
 * the connection are left alone: revoking the feature must not silently repoint an
 * existing BYO connection at the platform client mid-reconnect.
 */
export function stripUnentitledOwnClientVars(
  variables: Record<string, string>,
  gate: OwnClientGate,
  storedVariables: Record<string, string> = {}
): Record<string, string> {
  if (gate.requiresOwnClient || gate.ownClientOptional) return variables
  const out = { ...variables }
  for (const key of ['clientId', 'clientSecret']) {
    if (out[key] && !storedVariables[key]) delete out[key]
  }
  return out
}
