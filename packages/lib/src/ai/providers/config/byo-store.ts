// packages/lib/src/ai/providers/config/byo-store.ts

import { splitConnectionValues } from '@auxx/credentials/crypto'
import {
  deleteCredential,
  findCredential,
  listCredentials,
  revealSecrets,
} from '@auxx/credentials/store'
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { getProviderByKey } from '../../../connections/providers/provider-registry'
import { resolveConnectionForRuntime } from '../../../connections/resolve-connection-for-runtime'
import { AI_PROVIDER_CONNECTION_KEY } from '../connection-provider-map'
import type { AiProviderCtx } from './context'

/**
 * Low-level BYO-key access against the unified `Credential` store. These functions own the
 * mapping between an AI provider and its seeded platform ConnectionDefinition + stored
 * credential rows. Higher layers (mutations, runtime-credentials) compose them.
 */

/**
 * Resolve the seeded platform ConnectionDefinition for an AI provider. Returns the
 * blueprint providerKey (e.g. 'openaiApi') + row id, or null when the provider isn't
 * mapped or its blueprint hasn't been seeded (ensurePlatformProviders).
 */
export async function resolveConnectionDefinition(
  ctx: AiProviderCtx,
  provider: string
): Promise<{ providerKey: string; connectionDefinitionId: string } | null> {
  const providerKey = AI_PROVIDER_CONNECTION_KEY[provider]
  if (!providerKey) return null
  const row = await ctx.db.query.ConnectionDefinition.findFirst({
    where: and(
      eq(schema.ConnectionDefinition.providerKey, providerKey),
      eq(schema.ConnectionDefinition.major, 1)
    ),
    columns: { id: true },
  })
  return row ? { providerKey, connectionDefinitionId: row.id } : null
}

/**
 * Split canonical AI credentials into secret-flagged vs plain variables. A thin adapter over the
 * shared `splitConnectionValues` primitive that resolves the provider's blueprint
 * connectionVariables first (the AI-specific part) and normalizes/drops empty values before the
 * shared def-flag split — the secret/plain decision and masked-echo dropping are single-sourced.
 */
export function splitAiCredentials(
  providerKey: string,
  credentials: Record<string, any>
): { secretFields: Record<string, string>; plainVariables: Record<string, string> } {
  const def = getProviderByKey(providerKey)
  // Normalize to strings and drop empties so a blank field never overwrites a stored value with
  // '' (AI-specific; the connections/apps surfaces drop empties at their own call sites).
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (value === undefined || value === null || value === '') continue
    values[key] = String(value)
  }
  return splitConnectionValues(def?.connectionVariables ?? [], values)
}

/** Reveal a credential's canonical field bag (plain connectionVariables + secret fields). */
export async function revealCredentialFields(
  ctx: AiProviderCtx,
  credentialId: string
): Promise<Record<string, any>> {
  const revealed = await revealSecrets<{ fields?: Record<string, any> }>(
    credentialId,
    ctx.organizationId
  )
  if (revealed.isErr()) return {}
  const plain = (revealed.value.record.metadata?.connectionVariables ?? {}) as Record<string, any>
  const secretFields = revealed.value.secrets.fields ?? {}
  return { ...plain, ...secretFields }
}

/** The org's primary (isDefault/newest) BYO credential id for an AI provider, or null. */
export async function findOrgProviderCredentialId(
  ctx: AiProviderCtx,
  providerKey: string
): Promise<string | null> {
  const found = await findCredential({
    organizationId: ctx.organizationId,
    kind: 'connection',
    type: providerKey,
    userId: null,
  })
  return found.isOk() && found.value ? found.value.id : null
}

/** A single BYO key in the provider's key list (no secret material). */
export interface ProviderCredentialSummary {
  id: string
  /** User-facing label ('Billing-team key'), falling back to the credential name. */
  label: string
  isDefault: boolean
  createdAt: Date
}

/**
 * List the org's provider-level BYO keys for an AI provider (newest first), each with its display
 * label and whether it is the provider-level default. When no row carries `isDefault`, the newest
 * is the effective default — mirroring the runtime resolver's `desc(isDefault), desc(createdAt)`.
 *
 * Model-pinned keys share the same `(kind, type, userId)` as provider-level keys (they're only
 * distinguished by a LoadBalancingConfig binding), so they are excluded here — the provider key
 * picker is for keys that back the provider-level default, not a single pinned model.
 */
export async function listOrgProviderCredentials(
  ctx: AiProviderCtx,
  provider: string
): Promise<ProviderCredentialSummary[]> {
  const providerKey = AI_PROVIDER_CONNECTION_KEY[provider]
  if (!providerKey) return []

  const [existing, poolBindings] = await Promise.all([
    listCredentials({
      organizationId: ctx.organizationId,
      kind: 'connection',
      type: providerKey,
      userId: null,
    }),
    ctx.db.query.LoadBalancingConfig.findMany({
      where: and(
        eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
        eq(schema.LoadBalancingConfig.provider, provider)
      ),
      columns: { connectionId: true },
    }),
  ])
  if (existing.isErr()) return []

  const pinnedIds = new Set(poolBindings.map((b) => b.connectionId).filter(Boolean))
  const rows = existing.value.filter((row) => !pinnedIds.has(row.id))
  if (rows.length === 0) return []

  const hasExplicitDefault = rows.some((row) => row.isDefault)
  return rows.map((row, index) => ({
    id: row.id,
    label: row.label ?? row.name,
    // No explicit default → the newest (first, since listCredentials is desc createdAt) wins.
    isDefault: hasExplicitDefault ? row.isDefault : index === 0,
    createdAt: row.createdAt,
  }))
}

/**
 * Delete every org-scoped BYO credential for an AI provider from the unified store. The
 * LoadBalancingConfig.connectionId FK (onDelete: cascade) removes any pool bindings too.
 */
export async function deleteOrgProviderCredentials(
  ctx: AiProviderCtx,
  provider: string
): Promise<void> {
  const providerKey = AI_PROVIDER_CONNECTION_KEY[provider]
  if (!providerKey) return
  const existing = await listCredentials({
    organizationId: ctx.organizationId,
    kind: 'connection',
    type: providerKey,
    userId: null,
  })
  if (existing.isErr()) return
  for (const cred of existing.value) {
    await deleteCredential(cred.id, ctx.organizationId)
  }
}

/**
 * Resolve the org's provider-default key fields (the primary among its BYO keys) from the
 * unified store, by blueprint providerKey. Returns the canonical field bag or null.
 */
export async function resolveProviderDefaultFields(
  ctx: AiProviderCtx,
  providerKey: string
): Promise<Record<string, any> | null> {
  const resolved = await resolveConnectionForRuntime({
    providerKey,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    ensureFresh: false,
  })
  if (resolved.isErr()) return null
  return resolved.value.organizationConnection?.fields ?? null
}

/**
 * Gather the enabled pool members for a (provider, model, modelType), revealing each
 * bound credential's canonical fields. A size-1 result is a pinned key.
 */
export async function resolveModelPool(
  ctx: AiProviderCtx,
  provider: string,
  model: string,
  modelType: string
): Promise<Array<{ id: string; name: string; fields: Record<string, any> }>> {
  const rows = await ctx.db.query.LoadBalancingConfig.findMany({
    where: and(
      eq(schema.LoadBalancingConfig.organizationId, ctx.organizationId),
      eq(schema.LoadBalancingConfig.provider, provider),
      eq(schema.LoadBalancingConfig.model, model),
      eq(schema.LoadBalancingConfig.modelType, modelType),
      eq(schema.LoadBalancingConfig.enabled, true)
    ),
  })
  const members: Array<{ id: string; name: string; fields: Record<string, any> }> = []
  for (const row of rows) {
    if (!row.connectionId) continue
    const fields = await revealCredentialFields(ctx, row.connectionId)
    if (Object.keys(fields).length > 0) members.push({ id: row.id, name: row.name, fields })
  }
  return members
}
