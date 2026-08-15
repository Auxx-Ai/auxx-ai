// apps/web/src/components/threads/hooks/use-thread-title.ts

import type { ParticipantId } from '@auxx/types'
import { useMemo } from 'react'
import { useChannel } from '~/components/channels/hooks/use-channels'
import { pickThreadCounterparty, resolveThreadTitle } from '../utils/thread-title'
import { useMessageParticipants } from './use-message-participants'
import { useThread } from './use-thread'

const NO_PARTICIPANTS: ParticipantId[] = []

/**
 * The sending channel's own address/number, used to drop ourselves from a
 * thread's participant list. Email channels carry it on `email`; Quo/openphone
 * rows carry a NULL email and keep the number on `metadata.phoneNumber`.
 */
function channelSelfIdentifier(channel: { email?: string | null; metadata?: unknown } | undefined) {
  if (channel?.email) return channel.email
  const metadata = channel?.metadata as { phoneNumber?: unknown } | null | undefined
  return typeof metadata?.phoneNumber === 'string' ? metadata.phoneNumber : null
}

/**
 * Render-time title for a thread — the one derivation every thread surface
 * shares.
 *
 * Returns the thread's subject when it has one, a participant-derived title on
 * channels that have no subject at all (SMS/WhatsApp/DMs), and `null` when the
 * caller should render its own empty-subject placeholder. See
 * `resolveThreadTitle` for why the derived title is never persisted.
 *
 * Costs no extra network call: `ThreadMeta.participants` is the latest
 * message's envelope (metadata tier, so it survives every mail lens), the
 * participant store batches its lookups, and the channel comes from the
 * already-hydrated channel store.
 */
export function useThreadTitle(threadId: string | null | undefined): string | null {
  const { thread } = useThread({ threadId })
  const channel = useChannel(thread?.integrationId)
  const { from, to, cc } = useMessageParticipants(thread?.participants ?? NO_PARTICIPANTS)

  return useMemo(() => {
    const participant = pickThreadCounterparty([from, ...to, ...cc], channelSelfIdentifier(channel))
    return resolveThreadTitle({
      subject: thread?.subject,
      integrationProvider: thread?.integrationProvider,
      participant,
    })
  }, [thread?.subject, thread?.integrationProvider, from, to, cc, channel])
}
