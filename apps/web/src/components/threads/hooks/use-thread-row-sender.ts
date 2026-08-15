// apps/web/src/components/threads/hooks/use-thread-row-sender.ts

import type { ParticipantId } from '@auxx/types'
import { useMemo } from 'react'
import type { ParticipantMeta } from '../store'
import { useMessageParticipants } from './use-message-participants'

/**
 * The participant a thread LIST ROW should name: the counterparty, never us.
 *
 * A row names the latest message's sender, which is right until *we* sent that message — then it
 * names the org's own identity. On email that reads as merely odd (your own display name on a
 * thread you sent last). On a phone channel it reads as broken: an outbound-first SMS thread is
 * titled with the support line's own number, e.g. `+18889155797` where the customer belongs. And
 * outbound-first is the *normal* shape on SMS, because composing is how a conversation starts.
 *
 * So: keep the FROM when it is external, otherwise fall back to the first external TO/CC. When
 * everyone is internal (an all-internal thread) the FROM is still the right answer.
 *
 * `isInternal` is load-bearing here and is now trustworthy on every identifier type — #1655 made
 * the classifier read the channel's own identity (phone included) instead of only own-domain, and
 * made the column recomputable on both upserts.
 *
 * This lives in a hook rather than in a component because it did not, once: the logic existed in
 * `mail-thread-item` and not in `compact-thread-item`, which renders the list. The sibling
 * derivation (`useThreadTitle`) was centralised and stayed correct in both. Add a third row
 * component and it gets this for free; copy the block instead and the bug comes back.
 */
export function useThreadRowSender(participantIds: ParticipantId[]): ParticipantMeta | undefined {
  const { from, to, cc } = useMessageParticipants(participantIds)

  return useMemo(() => {
    if (from && !from.isInternal) return from
    const external = [from, ...to, ...cc].find((p) => p && !p.isInternal)
    return external ?? from ?? undefined
  }, [from, to, cc])
}
