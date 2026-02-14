// apps/web/src/components/threads/hooks/use-participant.ts

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { type ParticipantMeta, useParticipantStore } from '../store'

interface UseParticipantOptions {
  participantId: string | null | undefined
  enabled?: boolean
}

interface UseParticipantResult {
  participant: ParticipantMeta | undefined
  isLoading: boolean
  isNotFound: boolean
}

/**
 * Hook to get a single participant by ID.
 *
 * @example
 * const { participant } = useParticipant({ participantId: 'part123' })
 */
export function useParticipant({
  participantId,
  enabled = true,
}: UseParticipantOptions): UseParticipantResult {
  const participant = useParticipantStore(
    useCallback(
      (state) => (participantId ? state.participants.get(participantId) : undefined),
      [participantId]
    )
  )

  const isLoading = useParticipantStore(
    useCallback(
      (state) => (participantId ? state.isParticipantLoading(participantId) : false),
      [participantId]
    )
  )

  const isNotFound = useParticipantStore(
    useCallback(
      (state) => (participantId ? state.notFoundIds.has(participantId) : false),
      [participantId]
    )
  )

  const requestedRef = useRef<Set<string>>(new Set())
  const requestParticipant = useParticipantStore((s) => s.requestParticipant)

  useLayoutEffect(() => {
    if (!enabled || !participantId) return
    if (participant) return
    if (requestedRef.current.has(participantId)) return

    requestedRef.current.add(participantId)
    requestParticipant(participantId)
  }, [enabled, participantId, participant, requestParticipant])

  // biome-ignore lint/correctness/useExhaustiveDependencies: participantId triggers clearing the requested set
  useEffect(() => {
    requestedRef.current.clear()
  }, [participantId])

  return {
    participant,
    isLoading: !participant && isLoading,
    isNotFound,
  }
}
