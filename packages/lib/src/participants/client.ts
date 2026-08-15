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
  isSpammer: boolean
  /** True when the participant's identifier is on the organization's own domain. */
  isInternal: boolean
}
