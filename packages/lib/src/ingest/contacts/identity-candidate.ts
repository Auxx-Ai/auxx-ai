// packages/lib/src/ingest/contacts/identity-candidate.ts

import type { IdentifierTypeValue } from '@auxx/database/enums'
import { IdentifierType as IdentifierTypeEnum } from '@auxx/database/enums'
import type { ParticipantEntity as Participant } from '@auxx/database/types'
import { formatPhoneNumber } from '@auxx/utils'
import { metaExternalId } from './external-id'

/**
 * The platform a social identifier belongs to, and therefore its
 * `RecordIdentity.source` namespace.
 *
 * A PSID/IGSID is not an address — it is an opaque id that only means anything
 * inside one platform's id space, which is exactly what the identity index is
 * for. `metaExternalId` builds the stored `"<source>:<id>"` value, the same
 * retired-`external_id` encoding `parseExternalIdentity` splits on the first
 * colon.
 */
const SOCIAL_PLATFORM: Partial<Record<IdentifierTypeValue, 'facebook' | 'instagram'>> = {
  [IdentifierTypeEnum.FACEBOOK_PSID]: 'facebook',
  [IdentifierTypeEnum.INSTAGRAM_IGSID]: 'instagram',
}

export interface ContactIdentityCandidate {
  /**
   * The contact attribute this identifier dedupes on. `external_id` is not a
   * FieldValue — the lookup core routes it to the `RecordIdentity` index, and
   * `UnifiedCrudHandler.create` mirrors an array-valued `external_id` into the
   * same index instead of writing a cell.
   */
  systemAttribute: 'primary_email' | 'phone' | 'external_id'
  /** What to look up and write. Namespaced (`"facebook:123…"`) for `external_id`. */
  value: string
}

/**
 * Which contact attribute, if any, a participant's identifier dedupes on.
 *
 * Decided PER TYPE and never by falling through to email. This replaced a ladder
 * that *ended* in `primary_email`, so every type that was not a chat visitor or a
 * phone was assumed to be an email address: a 17-digit Meta PSID went into both
 * the lookup and the create payload, the write validator rejected it as an
 * uncoercible value, the FieldValue never landed, and the contact came out
 * carrying no identifier at all — nothing left to dedupe on, so every
 * conversation minted another contact.
 *
 * Returns `null` when the identifier is not addressable at all:
 *  - `CHAT_VISITOR` — an opaque session cuid, not an identity anyone else issues.
 *  - a `PHONE` that is not dialable — SMS short codes (`12345`) and alphanumeric
 *    sender ids (`AUXX`) share the type, and the write validator normalizes to
 *    E.164 and rejects those.
 *  - an identifier type added later that has not opted in here.
 *
 * A `null` candidate costs only the identifier-keyed dedupe — those participants
 * still resolve through `Participant.entityInstanceId`, written back by the
 * caller. That is why the unknown-type arm is `null` and not a guess: a missing
 * dedupe key is recoverable, a wrong one corrupts the contact graph silently.
 */
export function contactIdentityCandidate(
  participant: Pick<Participant, 'identifier' | 'identifierType'>
): ContactIdentityCandidate | null {
  const { identifier, identifierType } = participant

  if (identifierType === IdentifierTypeEnum.EMAIL) {
    return { systemAttribute: 'primary_email', value: identifier }
  }

  if (identifierType === IdentifierTypeEnum.PHONE) {
    return formatPhoneNumber(identifier) ? { systemAttribute: 'phone', value: identifier } : null
  }

  const platform = SOCIAL_PLATFORM[identifierType as IdentifierTypeValue]
  return platform
    ? { systemAttribute: 'external_id', value: metaExternalId(platform, identifier) }
    : null
}
