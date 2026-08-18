// packages/lib/src/providers/credential-auth-state.ts
//
// Classified auth-failure state (requiresReauth / lastAuthError / lastAuthErrorAt) lives on the
// linked Credential, not the Integration (Phase 6 of channels-onto-connections). These helpers
// resolve a channel's credential and update that state, so any caller holding only an
// integrationId can flag/clear the reconnect signal without re-implementing the join.
//
// Both helpers emit `channel.auth-state.changed` so the cached channel list
// (`channels` org-cache key, day-long TTL) picks up the new auth state — the
// UI's reauth banner and channel status read from that cache, not the DB.

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'

async function getCredentialRef(integrationId: string): Promise<{
  credentialId: string
  organizationId: string
  requiresReauth: boolean
  lastAuthError: string | null
} | null> {
  const [row] = await db
    .select({
      credentialId: schema.Integration.credentialId,
      organizationId: schema.Integration.organizationId,
      requiresReauth: schema.Credential.requiresReauth,
      lastAuthError: schema.Credential.lastAuthError,
    })
    .from(schema.Integration)
    .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)
  if (!row?.credentialId) return null
  return {
    credentialId: row.credentialId,
    organizationId: row.organizationId,
    requiresReauth: row.requiresReauth ?? false,
    lastAuthError: row.lastAuthError,
  }
}

/** Flag the channel's credential as needing re-auth (surfaces the reconnect banner). */
export async function markCredentialReauth(
  integrationId: string,
  lastAuthError: string,
  requiresReauth: boolean
): Promise<void> {
  const ref = await getCredentialRef(integrationId)
  if (!ref) return
  await db
    .update(schema.Credential)
    .set({ requiresReauth, lastAuthError, lastAuthErrorAt: new Date() })
    .where(eq(schema.Credential.id, ref.credentialId))
  await onCacheEvent('channel.auth-state.changed', { orgId: ref.organizationId })
}

/**
 * Clear the channel credential's auth-error state after a successful operation.
 * No-ops when there is nothing to clear — this runs after every successful
 * sync, and an unconditional write would bust the channels cache each time.
 */
export async function clearCredentialReauth(integrationId: string): Promise<void> {
  const ref = await getCredentialRef(integrationId)
  if (!ref) return
  if (!ref.requiresReauth && ref.lastAuthError === null) return
  await db
    .update(schema.Credential)
    .set({ requiresReauth: false, lastAuthError: null, lastAuthErrorAt: null })
    .where(eq(schema.Credential.id, ref.credentialId))
  await onCacheEvent('channel.auth-state.changed', { orgId: ref.organizationId })
}
