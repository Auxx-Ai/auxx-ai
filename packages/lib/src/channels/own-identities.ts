// packages/lib/src/channels/own-identities.ts

import { IdentifierType } from '@auxx/database/enums'
import type { IdentifierType as IdentifierTypeValue } from '@auxx/database/types'
import { formatPhoneNumber } from '@auxx/utils'
import type { CachedChannel } from '../cache/providers/channels-provider'
import { identifierTypeForProvider } from './capabilities'
import { getIdentifier } from './internal/identifier'

/**
 * Every identifier an org sends *as*, bucketed by the `IdentifierType` its
 * participants are keyed on. A `Participant` whose identifier is in the bucket
 * for its own type IS one of this org's channel identities — not a person the
 * org is talking to.
 *
 * Missing key = no channel of that type is connected, which is not the same as
 * "the answer is no for a reason" — it just means there is nothing to match.
 */
export type OwnIdentitySets = Readonly<Partial<Record<IdentifierTypeValue, ReadonlySet<string>>>>

/**
 * Build the per-type own-identity sets from the org-cache `channels` rows.
 *
 * Per identifier type:
 *  - `EMAIL` — each channel's primary `Integration.email` plus its
 *    provider-reported aliases (Outlook `metadata.emailAliases`, Gmail send-as
 *    `metadata.userEmails`). The SES forwarding address needs no special case:
 *    it is itself an `Integration.email` row (provider `email`,
 *    `metadata.systemManaged: true`).
 *  - `PHONE` — `metadata.phoneNumber`, normalized to E.164.
 *  - `FACEBOOK_PSID` / `INSTAGRAM_IGSID` — the channel's own Meta account id:
 *    `metadata.pageId` on a `facebook` channel, `metadata.instagramBusinessAccountId`
 *    on an `instagram` one.
 *  - `CHAT_VISITOR` — nothing, and unlike the Meta arm that premise still holds:
 *    the org's half of a chat is an EMAIL participant minted from the agent's
 *    user row (`chat/outbound.ts`), so no org-side identifier exists in the
 *    visitor id space at all.
 *
 * **Why the Meta arm exists — do not "simplify" it away.** On a Meta channel
 * BOTH sides of the conversation live in ONE id space: our Page id and the
 * customer's PSID are both `FACEBOOK_PSID`, and nothing but this set tells them
 * apart. (Email is the same shape — our address and theirs are both `EMAIL` —
 * but there the address itself carries the distinction; a bare numeric Meta id
 * carries none.) Ingest mints a page-side participant identified by the Page id
 * (`providers/social/webhook-message.ts`) and the composer sends FROM that same
 * id, so with no Meta arm our own Page is stored `isInternal: false` and the
 * thread list — which names a thread after its most recent *external*
 * participant — attributes every Meta conversation to ourselves.
 *
 * Exactly ONE id per channel is ours: the account id the channel routes as. Any
 * other PSID/IGSID names the customer, so this arm must never widen to "every
 * Meta id we have seen". It also reads the field the channel's own id space
 * names rather than going through `getIdentifier`, because an `instagram`
 * channel's metadata carries BOTH `pageId` (the Facebook page it publishes
 * through) and `instagramBusinessAccountId` — only the latter shares an id space
 * with the IGSIDs on its threads.
 *
 * **Phone identifiers are normalized through `formatPhoneNumber`, both here and
 * at every comparison site.** `Integration.metadata.phoneNumber` is E.164 today
 * (Quo hands us `selected.number` verbatim) but `normalizeIdentifier(x, PHONE)`
 * in ingest is a bare digit-strip, so `+18889155797`, `18889155797` and
 * `8889155797` are three distinct stored identifiers and only one of them
 * string-equals the metadata. Comparing raw strings works by luck on the
 * current provider and silently stops working on the next.
 *
 * Pure — takes already-fetched cache rows so callers own the cache-vs-query
 * decision (see `getOrgOwnEmailAddresses` in `./cache.ts`).
 */
export function buildOrgOwnIdentitySets(
  channels: readonly CachedChannel[],
  options?: { excludeInboxIds?: ReadonlySet<string> }
): OwnIdentitySets {
  const emails = new Set<string>()
  const phones = new Set<string>()
  const facebookPageIds = new Set<string>()
  const instagramAccountIds = new Set<string>()

  for (const channel of channels) {
    if (channel.inboxId && options?.excludeInboxIds?.has(channel.inboxId)) continue

    // Email aliases are read off metadata regardless of the provider's declared
    // identifier type — a channel can carry them without `getIdentifier`
    // choosing an email as its primary identity.
    if (channel.email) emails.add(normalizeOwnIdentifier(channel.email, IdentifierType.EMAIL))
    const metadata = channel.metadata as Record<string, unknown> | null
    addAliasArray(emails, metadata?.emailAliases) // Outlook proxy addresses
    addAliasArray(emails, metadata?.userEmails) // Gmail verified send-as

    const type = identifierTypeForProvider(channel.provider)

    if (type === IdentifierType.PHONE) {
      const identifier = getIdentifier(channel)
      if (!identifier) continue
      const normalized = normalizeOwnIdentifier(identifier, IdentifierType.PHONE)
      if (normalized) phones.add(normalized)
      continue
    }

    // The Meta arm — see the "why" in the doc comment above. One id per channel,
    // read off the field its own id space names.
    if (type === IdentifierType.FACEBOOK_PSID) {
      addMetadataId(facebookPageIds, metadata?.pageId, type)
    } else if (type === IdentifierType.INSTAGRAM_IGSID) {
      addMetadataId(instagramAccountIds, metadata?.instagramBusinessAccountId, type)
    }
  }

  const sets: Partial<Record<IdentifierTypeValue, ReadonlySet<string>>> = {}
  if (emails.size > 0) sets[IdentifierType.EMAIL] = emails
  if (phones.size > 0) sets[IdentifierType.PHONE] = phones
  if (facebookPageIds.size > 0) sets[IdentifierType.FACEBOOK_PSID] = facebookPageIds
  if (instagramAccountIds.size > 0) sets[IdentifierType.INSTAGRAM_IGSID] = instagramAccountIds
  return sets
}

/**
 * Fold an identifier into the form the own-identity sets are keyed on.
 *
 * MUST be applied to both sides of every membership test — the stored
 * `Participant.identifier` as well as the channel's own identifier — or the
 * comparison depends on which normalizer happened to write the row.
 * Returns `''` for a phone number that can't be parsed (short codes,
 * alphanumeric sender ids), which never matches a channel identity.
 */
export function normalizeOwnIdentifier(identifier: string, type: IdentifierTypeValue): string {
  const trimmed = identifier.trim()
  if (!trimmed) return ''
  if (type === IdentifierType.PHONE) return formatPhoneNumber(trimmed) ?? ''
  return trimmed.toLowerCase()
}

/**
 * Is this identifier one of the org's own channel identities?
 *
 * Normalizes the probe before testing, so callers can pass a raw stored
 * identifier without knowing which normalizer wrote it.
 */
export function isOwnChannelIdentity(
  sets: OwnIdentitySets,
  identifier: string,
  type: IdentifierTypeValue
): boolean {
  const normalized = normalizeOwnIdentifier(identifier, type)
  if (!normalized) return false
  return sets[type]?.has(normalized) ?? false
}

/**
 * The EMAIL arm alone, as a plain `Set`.
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
 * Both genuinely want the email arm and only the email arm — neither has any
 * business seeing a phone number — so this stays a distinct entry point rather
 * than becoming a lookup into {@link OwnIdentitySets} at those call sites.
 */
export function buildOrgOwnEmailAddressSet(
  channels: readonly CachedChannel[],
  options?: { excludeInboxIds?: ReadonlySet<string> }
): Set<string> {
  const emails = buildOrgOwnIdentitySets(channels, options)[IdentifierType.EMAIL]
  return new Set(emails ?? [])
}

/** Adds one metadata-sourced identifier to `target`, folded for its type, if it is a usable string. */
function addMetadataId(target: Set<string>, value: unknown, type: IdentifierTypeValue): void {
  if (typeof value !== 'string') return
  const normalized = normalizeOwnIdentifier(value, type)
  if (normalized) target.add(normalized)
}

/** Adds every non-empty string entry of `value` (lowercased, trimmed) to `target`. */
function addAliasArray(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) target.add(entry.trim().toLowerCase())
  }
}
