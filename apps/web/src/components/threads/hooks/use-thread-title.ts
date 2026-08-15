// apps/web/src/components/threads/hooks/use-thread-title.ts

import { useMemo } from 'react'
import { resolveThreadTitle } from '../utils/thread-title'
import { useThread } from './use-thread'
import { useThreadEnvelopeCounterparty } from './use-thread-envelope-counterparty'

/**
 * Render-time title for a thread — the one derivation every thread surface
 * shares.
 *
 * Returns the thread's subject when it has one, a participant-derived title on
 * channels that have no subject at all (SMS/WhatsApp/DMs), and `null` when the
 * caller should render its own empty-subject placeholder. See
 * `resolveThreadTitle` for why the derived title is never persisted.
 *
 * Counterparty selection lives in {@link useThreadEnvelopeCounterparty}, shared with the
 * composer's default recipient so a thread is titled after exactly the person it
 * would be addressed to.
 */
export function useThreadTitle(threadId: string | null | undefined): string | null {
  const { thread } = useThread({ threadId })
  const participant = useThreadEnvelopeCounterparty(threadId)

  return useMemo(
    () =>
      resolveThreadTitle({
        subject: thread?.subject,
        integrationProvider: thread?.integrationProvider,
        participant,
      }),
    [thread?.subject, thread?.integrationProvider, participant]
  )
}
