// apps/web/src/components/threads/hooks/use-participants.ts

import { useLayoutEffect, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useParticipantStore, type ParticipantMeta } from '../store'

/**
 * Hook to get multiple participants.
 * Returns Map for O(1) lookup.
 *
 * @example
 * const participants = useParticipants(['part1', 'part2'])
 * const sender = participants.get('part1')
 */
export function useParticipants(participantIds: string[]): Map<string, ParticipantMeta> {
  // Create stable key for comparison
  const idsKey = useMemo(() => participantIds.join(','), [participantIds])

  const participants = useParticipantStore(
    useShallow((s) => {
      const result = new Map<string, ParticipantMeta>()
      for (const id of idsKey.split(',').filter(Boolean)) {
        const p = s.participants.get(id)
        if (p) result.set(id, p)
      }
      return result
    })
  )

  const requestParticipant = useParticipantStore((s) => s.requestParticipant)

  // Request all missing participants
  useLayoutEffect(() => {
    for (const id of participantIds) {
      if (id) {
        requestParticipant(id)
      }
    }
  }, [participantIds, requestParticipant])

  return participants
}

/**
 * Get participants as array (ordered by input IDs).
 */
export function useParticipantsArray(participantIds: string[]): ParticipantMeta[] {
  const map = useParticipants(participantIds)
  return participantIds
    .map((id) => map.get(id))
    .filter((p): p is ParticipantMeta => p !== undefined)
}
