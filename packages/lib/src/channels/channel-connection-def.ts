// packages/lib/src/channels/channel-connection-def.ts
// Bridge the channel runtime's provider vocabulary (Integration.provider — a
// ChannelProviderType like 'google'/'outlook') to the unified connection model's
// providerKey ('gmail'/'outlookMail'), and resolve the platform ConnectionDefinition
// a channel credential binds to. The inverse of provisioning-hook's PROVIDER_BY_KEY.

import { type Database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

/** ChannelProviderType (`Integration.provider`) → ConnectionDefinition.providerKey. */
export const CHANNEL_PROVIDER_TO_KEY: Record<string, string> = {
  google: 'gmail',
  outlook: 'outlookMail',
  imap: 'imap',
}

/**
 * Map a channel's runtime provider to its connection providerKey (the identity stored on
 * the credential). Unknown providers pass through unchanged.
 */
export function channelProviderKey(provider: string): string {
  return CHANNEL_PROVIDER_TO_KEY[provider] ?? provider
}

/**
 * Resolve the platform ConnectionDefinition id for a channel providerKey, or null when the
 * provider has no seeded definition (e.g. IMAP in environments where it isn't provisioned).
 * The FK is still nullable through Phase 0/1, so a null is tolerated until the NOT NULL flip.
 */
export async function resolveChannelDefinitionId(
  db: Database,
  providerKey: string
): Promise<string | null> {
  const def = await db.query.ConnectionDefinition.findFirst({
    where: eq(schema.ConnectionDefinition.providerKey, providerKey),
    columns: { id: true },
  })
  return def?.id ?? null
}
