// packages/lib/src/providers/credential-auth-state.ts
//
// Classified auth-failure state (requiresReauth / lastAuthError / lastAuthErrorAt) lives on the
// linked Credential, not the Integration (Phase 6 of channels-onto-connections). These helpers
// resolve a channel's credential and update that state, so any caller holding only an
// integrationId can flag/clear the reconnect signal without re-implementing the join.

import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

async function getCredentialId(integrationId: string): Promise<string | null> {
  const [row] = await db
    .select({ credentialId: schema.Integration.credentialId })
    .from(schema.Integration)
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)
  return row?.credentialId ?? null
}

/** Flag the channel's credential as needing re-auth (surfaces the reconnect banner). */
export async function markCredentialReauth(
  integrationId: string,
  lastAuthError: string,
  requiresReauth: boolean
): Promise<void> {
  const credentialId = await getCredentialId(integrationId)
  if (!credentialId) return
  await db
    .update(schema.Credential)
    .set({ requiresReauth, lastAuthError, lastAuthErrorAt: new Date() })
    .where(eq(schema.Credential.id, credentialId))
}

/** Clear the channel credential's auth-error state after a successful operation. */
export async function clearCredentialReauth(integrationId: string): Promise<void> {
  const credentialId = await getCredentialId(integrationId)
  if (!credentialId) return
  await db
    .update(schema.Credential)
    .set({ requiresReauth: false, lastAuthError: null, lastAuthErrorAt: null })
    .where(eq(schema.Credential.id, credentialId))
}
