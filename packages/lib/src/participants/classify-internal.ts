// packages/lib/src/participants/classify-internal.ts

import { IdentifierType } from '@auxx/database/enums'
import type { IdentifierType as IdentifierTypeValue } from '@auxx/database/types'
// Direct module import, NOT the `../channels` barrel — that re-exports `./sync`
// and drags bullmq into every consumer of this file.
import {
  buildOrgOwnIdentitySets,
  isOwnChannelIdentity,
  type OwnIdentitySets,
} from '../channels/own-identities'
import {
  extractRegistrableDomain,
  getOwnDomains,
  normalizeDomain,
} from '../ingest/domain/classifier'

export interface ClassifyIsInternalInput {
  organizationId: string
  /** The participant identifier, already normalized for its type. */
  identifier: string
  identifierType: IdentifierTypeValue
  /**
   * Pre-fetched own-identity sets. Supply a per-batch value on hot ingest paths;
   * omitted, they are resolved from the org cache on demand.
   */
  ownIdentities?: OwnIdentitySets
  /**
   * Extra own-identity sets local to the caller — an `IngestContext`'s
   * `ownIdentities`, populated by the provider directly off the integration it
   * just initialized. Checked BEFORE the org-cache sets because it is fresher:
   * the first sync after a connect must not depend on a cache refresh having
   * landed yet.
   */
  contextIdentities?: OwnIdentitySets
  /** Pre-fetched org domains (EMAIL rung only). Resolved on demand when absent. */
  ownDomains?: ReadonlySet<string>
}

/**
 * Is this participant on the org's side of the conversation?
 *
 * THE classifier — `ingest/participants/find-or-create.ts` and
 * `participants/participant-service.ts` both call it. They used to carry
 * separate implementations that disagreed (ingest checked the integration's own
 * addresses, the service only checked org domains), so the same address could
 * be classified differently depending on whether it arrived through ingest or
 * through the composer.
 *
 * Three rungs, in order:
 *  1. **Context identities** — the active integration's own identifiers, passed
 *     in by the provider. Freshest; survives a cold org cache.
 *  2. **Channel identities** — every connected channel's own identifier, from
 *     the org cache, bucketed by identifier type
 *     (`buildOrgOwnIdentitySets`). This is the rung that works on phone.
 *  3. **Org domains** — `EMAIL` only.
 *
 * ## The reach differs per identifier type, deliberately
 *
 * Rung 3 has no analogue on the other channels and one must not be invented: an
 * area code is not a domain, and treating it as one would mark every customer in
 * the org's own city as internal. So:
 *
 *  - `EMAIL` → channel identities ∪ org domains. Broad: a teammate mailing the
 *    shared inbox from their own address on the org domain reads as internal.
 *  - `PHONE` → channel identities only. Narrow, and exactly what the channel
 *    gives you: our connected numbers, nothing else. A teammate texting the
 *    support line from a personal mobile reads as external, because there is no
 *    honest way to know otherwise. (`User.phoneNumber` exists but is
 *    unpopulated, un-normalized, and answering "is this a support conversation"
 *    from it is a product decision, not a lookup.)
 *  - `FACEBOOK_PSID` / `INSTAGRAM_IGSID` → channel identities only, and the set
 *    holds exactly one id per channel: our Page id / IG business account id.
 *    Both sides of a Meta conversation live in this one id space — ingest mints
 *    a page-side participant identified by the Page id — so the set is the only
 *    thing that says which of two numeric ids is us. Every other PSID/IGSID
 *    names the customer; do not widen this rung.
 *  - `CHAT_VISITOR` → always external. There is no org-side identifier in that
 *    id space at all: the org's half of a chat is an EMAIL participant minted
 *    from the agent's user row (`chat/outbound.ts`), which rungs 1–3 classify on
 *    the email path.
 *
 * That asymmetry is the honest ceiling of what each channel carries, not a gap
 * to close. Don't "fix" it by widening rung 3.
 */
export async function classifyIsInternal(input: ClassifyIsInternalInput): Promise<boolean> {
  const { organizationId, identifier, identifierType } = input
  if (!identifier) return false

  if (
    input.contextIdentities &&
    isOwnChannelIdentity(input.contextIdentities, identifier, identifierType)
  ) {
    return true
  }

  // The cache barrel is imported lazily: pulling it in statically widens this
  // module's graph enough to break collection in the lib test suites that mock
  // `@auxx/database` partially. Callers on hot paths pass `ownIdentities` in
  // and never reach this.
  const ownIdentities =
    input.ownIdentities ??
    buildOrgOwnIdentitySets(
      await (await import('../cache')).getOrgCache().get(organizationId, 'channels')
    )
  if (isOwnChannelIdentity(ownIdentities, identifier, identifierType)) return true

  // Rung 3 is EMAIL-only by construction — see the doc comment above.
  if (identifierType !== IdentifierType.EMAIL) return false
  const domain = extractRegistrableDomain(identifier)
  if (!domain) return false
  const ownDomains = input.ownDomains ?? (await getOwnDomains(organizationId))
  return ownDomains.has(normalizeDomain(domain))
}
