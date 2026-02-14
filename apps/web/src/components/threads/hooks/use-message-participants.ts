// apps/web/src/components/threads/hooks/use-message-participants.ts

import { getParticipantRawId, groupParticipantsByRole, type ParticipantId } from '@auxx/types'
import { useMemo } from 'react'
import type { ParticipantMeta } from '../store'
import { useParticipants } from './use-participants'

interface UseMessageParticipantsResult {
  from: ParticipantMeta | undefined
  replyTo: ParticipantMeta | undefined
  to: ParticipantMeta[]
  cc: ParticipantMeta[]
  bcc: ParticipantMeta[]
  isLoading: boolean
}

/**
 * Hook to get resolved participants for a message.
 * Parses ParticipantId[] and returns grouped ParticipantMeta.
 *
 * @example
 * const { from, to, cc } = useMessageParticipants(message.participants)
 */
export function useMessageParticipants(
  participantIds: ParticipantId[]
): UseMessageParticipantsResult {
  // Extract unique raw IDs for batch fetch
  const uniqueIds = useMemo(() => {
    const ids = new Set<string>()
    for (const pid of participantIds) {
      ids.add(getParticipantRawId(pid))
    }
    return Array.from(ids)
  }, [participantIds])

  // Fetch all participants
  const participantMap = useParticipants(uniqueIds)

  // Group by role and resolve to ParticipantMeta
  return useMemo(() => {
    const grouped = groupParticipantsByRole(participantIds)

    return {
      from: grouped.from ? participantMap.get(grouped.from) : undefined,
      replyTo: grouped.replyto ? participantMap.get(grouped.replyto) : undefined,
      to: grouped.to
        .map((id) => participantMap.get(id))
        .filter((p): p is ParticipantMeta => p !== undefined),
      cc: grouped.cc
        .map((id) => participantMap.get(id))
        .filter((p): p is ParticipantMeta => p !== undefined),
      bcc: grouped.bcc
        .map((id) => participantMap.get(id))
        .filter((p): p is ParticipantMeta => p !== undefined),
      isLoading: uniqueIds.length > participantMap.size,
    }
  }, [participantIds, participantMap, uniqueIds.length])
}
