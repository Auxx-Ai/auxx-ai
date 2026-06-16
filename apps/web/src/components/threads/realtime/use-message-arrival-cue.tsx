// apps/web/src/components/threads/realtime/use-message-arrival-cue.tsx

'use client'

import { groupParticipantsByRole } from '@auxx/types'
import { toastMessage } from '@auxx/ui/components/toast'
import { MailPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { markUnseenMessages } from '~/components/global/new-message-indicator/store'
import { NEW_MESSAGE_SOUND, playNotificationSound } from '~/lib/play-notification-sound'
import { useDehydratedSettings } from '~/providers/dehydrated-state-provider'
import { getMessageStoreState } from '../store/message-store'
import { getParticipantStoreState } from '../store/participant-store'
import { getThreadSelectionState } from '../store/thread-selection-store'

/**
 * Coalescing window. Incoming messages buffer for this long before a cue
 * fires, so a burst on one thread collapses to a single cue and a burst across
 * threads collapses to one "N new messages" cue.
 */
const FLUSH_MS = 1000

/** Resolve the best sender label for a message from the participant store. */
function resolveSender(messageId: string): string | null {
  const msg = getMessageStoreState().getMessage(messageId)
  if (!msg) return null
  const fromId = groupParticipantsByRole(msg.participants).from
  if (!fromId) return null
  const participant = getParticipantStoreState().getParticipant(fromId)
  return participant?.displayName || participant?.name || participant?.identifier || null
}

/**
 * New-message arrival cue. Returns a `cueIncomingMessage(messageId, threadId)`
 * callback for `useMailSync` to call once an inbound `message:created` has
 * landed in the message store.
 *
 * Behaviour:
 * - Incoming only — outbound sends are skipped (`isInbound` guard).
 * - Suppressed when the user is already viewing that thread.
 * - De-duped per thread (latest message wins) and coalesced across threads
 *   inside a short window: one thread → "New message from X" with a preview,
 *   many threads → "N new messages".
 * - Clicking the cue opens the thread (or the mailbox, for the burst case).
 */
export function useMessageArrivalCue() {
  const router = useRouter()

  // Sound preference (default on). Read from dehydrated state and mirrored into
  // a ref so the non-React flush callback sees the latest value.
  const settings = useDehydratedSettings()
  const soundEnabledRef = useRef(true)
  soundEnabledRef.current = settings['notification.sound.newMessage'] !== false

  // threadId -> latest messageId, drained on flush.
  const pendingRef = useRef(new Map<string, string>())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openThread = useCallback(
    (threadId: string) => {
      router.push(`/app/mail?tid=${threadId}`)
    },
    [router]
  )

  const flush = useCallback(() => {
    timerRef.current = null
    const entries = Array.from(pendingRef.current.entries())
    pendingRef.current.clear()
    if (entries.length === 0) return

    // One chime per cue (after coalescing), gated on the user preference.
    if (soundEnabledRef.current) playNotificationSound(NEW_MESSAGE_SOUND)

    if (entries.length === 1) {
      const [threadId, messageId] = entries[0]
      const sender = resolveSender(messageId)
      const snippet = getMessageStoreState().getMessage(messageId)?.snippet ?? undefined
      toastMessage({
        title: sender ? `New message from ${sender}` : 'New message',
        description: snippet,
        icon: <MailPlus className='size-5 text-blue-500' />,
        onClick: () => openThread(threadId),
      })
      return
    }

    toastMessage({
      title: `${entries.length} new messages`,
      icon: <MailPlus className='size-5 text-blue-500' />,
      onClick: () => router.push('/app/mail'),
    })
  }, [openThread, router])

  const cueIncomingMessage = useCallback(
    (messageId: string, threadId: string) => {
      const msg = getMessageStoreState().getMessage(messageId)
      // Incoming only — skip the user's own outbound sends.
      if (!msg || !msg.isInbound) return
      // Don't cue the thread the user is already reading.
      if (getThreadSelectionState().activeThreadId === threadId) return

      // Flip the out-of-tab indicator (favicon dot + title prefix) immediately —
      // it doesn't wait for the toast's coalescing window.
      markUnseenMessages()

      // Warm the sender so its name is resolvable by flush time.
      const fromId = groupParticipantsByRole(msg.participants).from
      if (fromId) getParticipantStoreState().requestParticipant(fromId)

      // Latest message per thread wins (de-dupe within the window).
      pendingRef.current.set(threadId, messageId)
      if (!timerRef.current) timerRef.current = setTimeout(flush, FLUSH_MS)
    },
    [flush]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return cueIncomingMessage
}
