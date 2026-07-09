// apps/web/src/components/mail/hooks/use-thread-counterparty.ts

import { groupParticipantsByRole } from '@auxx/types'
import { useMemo } from 'react'
import { useMessages, useParticipants } from '~/components/threads/hooks'
import type { ParticipantMeta } from '~/components/threads/store'

export interface ThreadCounterparty {
  /** Earliest external participant across the thread (FROM before TO/CC). */
  primary: ParticipantMeta | null
  /** Remaining external participants, in first-seen order (deduped). */
  others: ParticipantMeta[]
  /** FROM of the first message — used when the thread is internal-only. */
  fallback: ParticipantMeta | null
  isLoading: boolean
}

/**
 * Resolve a thread's counterparty (the external person the org is talking to),
 * so owner-initiated threads show the recipient instead of the owner.
 *
 * Collects participant ids in message order (FROM first, then TO, then CC),
 * resolves them through the participant store, and returns the earliest
 * external as `primary` with the rest as `others`. Internal-only threads fall
 * back to the first message's FROM (today's behavior). No extra network call —
 * reads the messages already loaded for the open thread.
 */
export function useThreadCounterparty(threadId: string): ThreadCounterparty {
  const { messages, isLoading } = useMessages({ threadId })

  const orderedIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    const push = (id: string | null) => {
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
    for (const msg of messages) {
      const grouped = groupParticipantsByRole(msg.participants)
      push(grouped.from)
      for (const id of grouped.to) push(id)
      for (const id of grouped.cc) push(id)
    }
    return ids
  }, [messages])

  const participantMap = useParticipants(orderedIds)

  const fallbackId = useMemo(() => {
    const first = messages[0]
    return first ? groupParticipantsByRole(first.participants).from : null
  }, [messages])

  return useMemo(() => {
    const resolved = orderedIds
      .map((id) => participantMap.get(id))
      .filter((p): p is ParticipantMeta => p !== undefined)
    const externals = resolved.filter((p) => !p.isInternal)
    const fallback =
      (fallbackId ? participantMap.get(fallbackId) : undefined) ?? resolved[0] ?? null

    return {
      primary: externals[0] ?? null,
      others: externals.slice(1),
      fallback,
      isLoading,
    }
  }, [orderedIds, participantMap, fallbackId, isLoading])
}
