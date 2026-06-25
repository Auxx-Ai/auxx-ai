// packages/lib/src/connections/resolve-provider-key.ts
// Resolve a credential's providerKey from its ConnectionDefinition FK — the post-Phase-2
// replacement for reading the denormalized `Credential.type`. Provider identity lives on the
// definition (`ConnectionDefinition.providerKey`); a credential points at it via
// `connectionDefinitionId`. App/MCP-owned defs carry no providerKey (they identify by
// appId/mcpServerId), so those resolve to null — matching the old `type === null` semantics.

import { type Database, schema } from '@auxx/database'
import { inArray } from 'drizzle-orm'

/** Minimal credential shape needed to resolve a providerKey. */
interface CredentialDefRef {
  connectionDefinitionId: string | null
}

/**
 * The providerKey a single credential binds to, resolved from its ConnectionDefinition.
 * Returns null when the credential has no definition FK (a legacy row still pending the
 * Phase 1 backfill), the definition is gone, or the owner is an app/MCP server (no providerKey).
 * For lists, use {@link resolveProviderKeys} to avoid an N+1.
 */
export async function resolveProviderKey(
  db: Database,
  credential: CredentialDefRef
): Promise<string | null> {
  if (!credential.connectionDefinitionId) return null
  const def = await db.query.ConnectionDefinition.findFirst({
    where: (d, { eq }) => eq(d.id, credential.connectionDefinitionId!),
    columns: { providerKey: true },
  })
  return def?.providerKey ?? null
}

/**
 * Batch providerKey resolution keyed by credentialId — one query over the distinct definition
 * ids, no N+1. Credentials with no FK (or whose def has no providerKey, e.g. app/MCP rows) are
 * omitted; callers treat a missing key as "unresolved".
 */
export async function resolveProviderKeys(
  db: Database,
  credentials: Array<{ id: string; connectionDefinitionId: string | null }>
): Promise<Map<string, string>> {
  const byCredentialId = new Map<string, string>()
  const defIds = [
    ...new Set(
      credentials.map((c) => c.connectionDefinitionId).filter((id): id is string => id !== null)
    ),
  ]
  if (defIds.length === 0) return byCredentialId

  const defs = await db.query.ConnectionDefinition.findMany({
    where: inArray(schema.ConnectionDefinition.id, defIds),
    columns: { id: true, providerKey: true },
  })
  const providerKeyByDefId = new Map<string, string>()
  for (const def of defs) {
    if (def.providerKey) providerKeyByDefId.set(def.id, def.providerKey)
  }

  for (const cred of credentials) {
    if (!cred.connectionDefinitionId) continue
    const providerKey = providerKeyByDefId.get(cred.connectionDefinitionId)
    if (providerKey) byCredentialId.set(cred.id, providerKey)
  }
  return byCredentialId
}
