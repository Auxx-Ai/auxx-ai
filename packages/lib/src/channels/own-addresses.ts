// packages/lib/src/channels/own-addresses.ts

import type { CachedChannel } from '../cache/providers/channels-provider'

/**
 * Union of every address the org sends mail *as*: each non-deleted channel's
 * primary `email` plus its provider-reported aliases — Outlook
 * `metadata.emailAliases` and Gmail send-as `metadata.userEmails`
 * (`fetchAllUserEmails()`, persisted on the integration). This is the "us"
 * set: an inbound message whose `From` address is in it was sent from a
 * mailbox this org has connected.
 *
 * Two consumers, two readings — the set answers "is the sender one of ours",
 * which is NOT the same question as "is this a loop":
 *  - `store-message.ts` stamps `fromOwnAddress` on the `message:received`
 *    event and lets each workflow's trigger decide (default: fire). A
 *    teammate mailing the shared inbox from their own connected mailbox is in
 *    this set and is perfectly real mail, so membership alone must never
 *    suppress anything. The loop guard proper is `ownEcho`, which resolves
 *    `X-AuxxAi-Message-Id` to a row we actually sent.
 *  - `inbound-email-processor.ts` uses it for SES message DIRECTION, and
 *    passes `excludeInboxIds` covering the org's personal inboxes: mail from
 *    a teammate's personal mailbox arriving at a shared channel through the
 *    forwarding alias is inbound ON THAT CHANNEL, and marking it outbound
 *    renders it as an org reply in the thread.
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
export function buildOrgOwnEmailAddressSet(
  channels: readonly CachedChannel[],
  options?: { excludeInboxIds?: ReadonlySet<string> }
): Set<string> {
  const addresses = new Set<string>()
  for (const channel of channels) {
    if (channel.inboxId && options?.excludeInboxIds?.has(channel.inboxId)) continue
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
