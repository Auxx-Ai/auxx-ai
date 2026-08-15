// apps/web/src/components/threads/hooks/use-thread-envelope-counterparty.ts

import type { ParticipantId } from '@auxx/types'
import { useMemo } from 'react'
import { useChannel } from '~/components/channels/hooks/use-channels'
import type { ParticipantMeta } from '../store'
import { pickThreadCounterparty } from '../utils/thread-title'
import { useMessageParticipants } from './use-message-participants'
import { useThread } from './use-thread'

const NO_PARTICIPANTS: ParticipantId[] = []

/**
 * The sending channel's own address/number, used to drop ourselves from a
 * thread's participant list. Email channels carry it on `email`; Quo/openphone
 * rows carry a NULL email and keep the number on `metadata.phoneNumber`.
 */
export function channelSelfIdentifier(
  channel: { email?: string | null; metadata?: unknown } | undefined
) {
  if (channel?.email) return channel.email
  const metadata = channel?.metadata as { phoneNumber?: unknown } | null | undefined
  return typeof metadata?.phoneNumber === 'string' ? metadata.phoneNumber : null
}

/**
 * The participant on the other side of a thread, resolved from the thread's
 * **envelope** — `ThreadMeta.participants`, the latest message's participant ids.
 *
 * Not to be confused with `~/components/mail/hooks/use-thread-counterparty`,
 * which answers a related but different question. The distinction is what each
 * one can afford to read:
 *
 * | | this hook | `mail/hooks` version |
 * |---|---|---|
 * | source | `ThreadMeta.participants` (envelope) | every message via `useMessages` |
 * | returns | one participant | `{ primary, others, fallback }` |
 * | excludes us by | `isInternal` **and** the channel's own identifier | `isInternal` only |
 * | usable in list rows | yes — no messages needed | no |
 *
 * The list-row constraint is why this one exists: `useThreadTitle` renders in
 * `mail-thread-item` / `compact-thread-item`, where a thread's messages are not
 * loaded and fetching them per row would be absurd.
 *
 * Keeping `selfIdentifier` in play is deliberate even though `isInternal` now
 * classifies PHONE participants correctly: it is a render-time check against the
 * channel actually in hand, so it stays right against a row whose stored flag is
 * stale, and costs one string compare.
 *
 * Costs no extra network call: the envelope is metadata tier (it survives every
 * mail lens), the participant store batches its lookups, and the channel comes
 * from the already-hydrated channel store.
 */
export function useThreadEnvelopeCounterparty(
  threadId: string | null | undefined
): ParticipantMeta | undefined {
  const { thread } = useThread({ threadId })
  const channel = useChannel(thread?.integrationId)
  const { from, to, cc } = useMessageParticipants(thread?.participants ?? NO_PARTICIPANTS)

  return useMemo(
    () => pickThreadCounterparty([from, ...to, ...cc], channelSelfIdentifier(channel)),
    [from, to, cc, channel]
  )
}
