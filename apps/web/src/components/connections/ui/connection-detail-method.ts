// apps/web/src/components/connections/ui/connection-detail-method.ts

import type { ConnectionVariable } from '@auxx/database'

/** One connect method an item exposes (the detail page renders + collects input for it). */
export interface DetailMethod {
  id: string
  label: string
  description: string | null
  connectionType: string
  /** true = organization-wide, false = user-specific. Shown as a scope hint. */
  global: boolean
  connectionVariables?: ConnectionVariable[] | null
  /** OAuth approval gate (§3.1): this connection must bring its own client id/secret. */
  requiresOwnClient?: boolean
  /**
   * BYO is offered as an optional alternative to the platform client — either because the
   * platform app is pending verification, or because the org holds `byoOAuthClient`.
   */
  ownClientOptional?: boolean
  ownClientReason?: 'no-platform-client' | 'pending-approval' | 'byo-entitled' | null
  /** Server-built OAuth redirect URI, shown so a BYO user can register it. */
  oauthCallbackUrl?: string | null
  /** The definition's always-requested scopes (the floor). Used to show the full resulting set. */
  oauth2Scopes?: string[] | null
  /** Scopes this connection MAY additionally request. Renders the optional-scope picker. */
  oauth2OptionalScopes?: string[] | null
}

/** A secret/variable method needs the field step; bare OAuth connects one-click. */
export function methodNeedsFields(method: DetailMethod): boolean {
  return method.connectionType === 'secret' || (method.connectionVariables?.length ?? 0) > 0
}

/** The BYO OAuth-client variable keys (client-side mirror of the server gate's set). */
const BYO_CLIENT_KEYS = new Set(['clientId', 'clientSecret'])

/** The platform client works and BYO is offered only as an opt-in alternative (§3.1). */
export function methodOffersOwnClient(method: DetailMethod): boolean {
  return (
    method.connectionType === 'oauth2-code' &&
    !!method.ownClientOptional &&
    !method.requiresOwnClient
  )
}

/**
 * Apply the BYO-client disclosure to an `ownClientOptional` method: closed → the optional
 * client fields are dropped so the platform login connects one-click; open → they render and
 * become required (a half-filled client pair must never reach the OAuth kickoff). Mandatory
 * (`requiresOwnClient`) and non-OAuth methods pass through untouched.
 */
export function applyOwnClientDisclosure<M extends DetailMethod>(method: M, byoOpen: boolean): M {
  if (!methodOffersOwnClient(method)) return method
  const vars = method.connectionVariables ?? []
  return {
    ...method,
    connectionVariables: byoOpen
      ? vars.map((v) => (BYO_CLIENT_KEYS.has(v.key) ? { ...v, required: true } : v))
      : vars.filter((v) => !BYO_CLIENT_KEYS.has(v.key)),
  }
}

/** A single-secret method (API key) with no structured variables. */
export function methodIsBareSecret(method: DetailMethod): boolean {
  return method.connectionType === 'secret' && (method.connectionVariables?.length ?? 0) === 0
}

/**
 * Offer declared optional scopes for either OAuth client. The authorize route
 * validates selections against the definition, and the provider decides the grant.
 */
export function shouldOfferOptionalScopes(method: DetailMethod): boolean {
  return method.connectionType === 'oauth2-code' && (method.oauth2OptionalScopes?.length ?? 0) > 0
}
