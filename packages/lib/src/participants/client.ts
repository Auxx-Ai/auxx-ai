// packages/lib/src/participants/client.ts

/**
 * Client-safe exports for participants module.
 * Types only - no database dependencies.
 */

/**
 * Identifier type for participants.
 *
 * Mirrors the `IdentifierType` pg enum (`schema/_shared.ts`) **completely** —
 * all five members, not the three that were once wired. `participant-service`
 * casts the DB value onto this type, so a short union does not narrow anything:
 * it just tells every consumer a Facebook or Instagram participant cannot
 * exist, and any `switch` written against it is unsound on live rows.
 */
export type ParticipantIdentifierType =
  | 'EMAIL'
  | 'PHONE'
  | 'FACEBOOK_PSID'
  | 'INSTAGRAM_IGSID'
  | 'CHAT_VISITOR'

/**
 * Participant display data for frontend store.
 */
export interface ParticipantMeta {
  id: string
  name: string | null
  identifier: string
  identifierType: ParticipantIdentifierType
  displayName: string
  initials: string
  avatarUrl: string | null
  /** Reference to EntityInstance (contact entity type) */
  entityInstanceId: string | null
  /**
   * The linked contact's `EntityInstance.displayName`, already normalized by
   * {@link usableContactName} — `null` when there is no linked (non-archived)
   * contact, or when its display value is just the identifier echoed back.
   * Kept separate from `displayName` on purpose: label precedence
   * (contactName > name > formatted identifier) is resolved in ONE client util,
   * and the composer's "real name vs identifier" honesty must survive.
   */
  contactName: string | null
  isSpammer: boolean
  /** True when the participant's identifier is on the organization's own domain. */
  isInternal: boolean
}

/**
 * Normalize a contact's display value into a usable *name* for a participant.
 *
 * Returns the trimmed name, or `null` when it is empty/whitespace or equal
 * (case-insensitive, trimmed) to the participant's identifier — a contact whose
 * display value IS the phone/email must not masquerade as a name.
 */
export function usableContactName(
  contactDisplayName: string | null | undefined,
  identifier: string | null | undefined
): string | null {
  const name = contactDisplayName?.trim()
  if (!name) return null
  if (identifier && name.toLowerCase() === identifier.trim().toLowerCase()) return null
  return name
}
