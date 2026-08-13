// packages/lib/src/channels/own-addresses.ts

import type { CachedChannel } from '../cache/providers/channels-provider'

/**
 * Union of every address the org sends mail *as*: each non-deleted channel's
 * primary `email` plus its provider-reported aliases — Outlook
 * `metadata.emailAliases` and Gmail send-as `metadata.userEmails`
 * (`fetchAllUserEmails()`, persisted on the integration). This is the "us"
 * set for the ingest own-address loop guard
 * (`plans/workflow/2026-08-12-message-trigger-scoping-and-send-safety.md`
 * §6 #1): an inbound message whose `From` address is in this set is our own
 * outbound mail echoing back through a different door (a second connected
 * channel, the SES forwarding alias, ...), not real inbound mail.
 *
 * The SES forwarding address needs no special case — it is itself an
 * `Integration.email` row (provider `email`, `metadata.systemManaged: true`,
 * see `organization-service.ts#ensureForwardingAddressIntegration`), already
 * covered by the primary-email pass. IMAP has no alias concept beyond
 * `Integration.email`.
 *
 * Pure — takes the already-fetched `channels` org-cache rows so callers
 * control the cache-vs-query decision (see `getOrgOwnEmailAddresses` in
 * `./cache.ts` for the cache-backed convenience wrapper).
 */
export function buildOrgOwnEmailAddressSet(channels: readonly CachedChannel[]): Set<string> {
  const addresses = new Set<string>()
  for (const channel of channels) {
    if (channel.email) addresses.add(channel.email.trim().toLowerCase())
    const metadata = channel.metadata as Record<string, unknown> | null
    addAliasArray(addresses, metadata?.emailAliases) // Outlook proxy addresses
    addAliasArray(addresses, metadata?.userEmails) // Gmail verified send-as
  }
  return addresses
}

/** Adds every non-empty string entry of `value` (lowercased, trimmed) to `target`. */
function addAliasArray(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) target.add(entry.trim().toLowerCase())
  }
}
