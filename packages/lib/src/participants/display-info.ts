// packages/lib/src/participants/display-info.ts

import { generateVisitorName } from '../chat/visitor-naming'

/**
 * Compute the display name + initials for a participant from its stored
 * columns — THE read-time repair for participant labels.
 *
 * For anonymous chat visitors the raw identifier is an opaque session UUID, so
 * when there's no name we surface the friendly `Cyan Turtle` handle instead of
 * the uuid. Callers should always prefer this over the persisted `displayName`
 * column: legacy CHAT_VISITOR rows have the raw session uuid stored there, and
 * the column is nullable besides. `ParticipantService.getParticipantMetaBatch`
 * and the search router both route through this so every surface repairs
 * identically.
 */
export function calculateParticipantDisplayInfo(
  name?: string | null,
  identifier?: string | null,
  identifierType?: string | null
): {
  displayName: string
  initials: string
} {
  const validName = name?.trim()
  const trimmedIdentifier = identifier?.trim()
  const identifierFallback =
    identifierType === 'CHAT_VISITOR' && trimmedIdentifier
      ? generateVisitorName(trimmedIdentifier)
      : (trimmedIdentifier ?? 'Unknown')
  const validIdentifier = identifierFallback
  const displayName = validName || validIdentifier
  let initials = '?'
  if (validName) {
    const nameParts = validName.split(' ').filter(Boolean)
    if (nameParts.length > 1) {
      initials =
        `${nameParts[0]?.[0] ?? ''}${nameParts[nameParts.length - 1]?.[0] ?? ''}`.toUpperCase()
    } else if (nameParts.length === 1) {
      initials = (nameParts[0]?.[0] ?? '').toUpperCase()
    }
  } else if (validIdentifier) {
    initials = (validIdentifier[0] ?? '?').toUpperCase()
    if (validIdentifier.includes('@')) {
      initials = (validIdentifier.split('@')[0]?.[0] ?? '?').toUpperCase()
    }
  }
  if (initials.length > 2) initials = initials.substring(0, 2)
  if (!initials || initials === '?') initials = displayName[0]?.toUpperCase() ?? '?'
  return { displayName, initials }
}
