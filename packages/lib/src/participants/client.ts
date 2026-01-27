// packages/lib/src/participants/client.ts

/**
 * Client-safe exports for participants module.
 * Types only - no database dependencies.
 */

/**
 * Identifier type for participants.
 */
export type ParticipantIdentifierType = 'EMAIL' | 'PHONE'

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
}
