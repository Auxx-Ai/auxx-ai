// packages/types/participant/index.ts

// ============================================================================
// ParticipantId - Branded String Type
// ============================================================================

/**
 * Branded ParticipantId type: "from:abc123", "to:xyz789", etc.
 * Combines participant role with ID in a single string format.
 *
 * Format: "{role}:{participantId}"
 * Roles: from, to, cc, bcc, replyto
 */
export type ParticipantId = string & { readonly __brand: 'ParticipantId' }

/** Participant role discriminator */
export type ParticipantRole = 'from' | 'to' | 'cc' | 'bcc' | 'replyto'

/** All valid participant roles */
export const PARTICIPANT_ROLES: ParticipantRole[] = ['from', 'to', 'cc', 'bcc', 'replyto']

/**
 * Parse ParticipantId into its components.
 * @throws Error if ParticipantId is malformed
 */
export function parseParticipantId(participantId: ParticipantId): {
  role: ParticipantRole
  id: string
} {
  if (!participantId) {
    throw new Error(`Invalid ParticipantId: ${participantId}`)
  }

  const colonIndex = participantId.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(`Invalid ParticipantId (missing colon): ${participantId}`)
  }

  const role = participantId.slice(0, colonIndex) as ParticipantRole
  const id = participantId.slice(colonIndex + 1)

  if (!role || !id || !PARTICIPANT_ROLES.includes(role)) {
    throw new Error(`Invalid ParticipantId: ${participantId}`)
  }

  return { role, id }
}

/**
 * Create ParticipantId from components.
 */
export function toParticipantId(role: ParticipantRole, id: string): ParticipantId {
  return `${role}:${id}` as ParticipantId
}

/**
 * Type guard to check if a string is a valid ParticipantId format.
 */
export function isParticipantId(value: unknown): value is ParticipantId {
  if (typeof value !== 'string') return false
  const colonIndex = value.indexOf(':')
  if (colonIndex === -1) return false
  const role = value.slice(0, colonIndex)
  return PARTICIPANT_ROLES.includes(role as ParticipantRole)
}

/**
 * Get the raw ID from a ParticipantId.
 */
export function getParticipantRawId(participantId: ParticipantId): string {
  return parseParticipantId(participantId).id
}

/**
 * Get the role from a ParticipantId.
 */
export function getParticipantRole(participantId: ParticipantId): ParticipantRole {
  return parseParticipantId(participantId).role
}

/**
 * Extract unique raw participant IDs from an array of ParticipantIds.
 * Useful for batching participant fetches.
 */
export function extractUniqueParticipantIds(participantIds: ParticipantId[]): string[] {
  const ids = new Set<string>()
  for (const pid of participantIds) {
    ids.add(getParticipantRawId(pid))
  }
  return Array.from(ids)
}

/**
 * Group ParticipantIds by role.
 */
export function groupParticipantsByRole(participantIds: ParticipantId[]): {
  from: string | null
  replyto: string | null
  to: string[]
  cc: string[]
  bcc: string[]
} {
  const result = {
    from: null as string | null,
    replyto: null as string | null,
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
  }

  for (const pid of participantIds) {
    const { role, id } = parseParticipantId(pid)
    switch (role) {
      case 'from':
        result.from = id
        break
      case 'replyto':
        result.replyto = id
        break
      case 'to':
        result.to.push(id)
        break
      case 'cc':
        result.cc.push(id)
        break
      case 'bcc':
        result.bcc.push(id)
        break
    }
  }

  return result
}
