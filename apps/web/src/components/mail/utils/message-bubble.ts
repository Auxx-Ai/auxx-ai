// apps/web/src/components/mail/utils/message-bubble.ts

import type { MessageType } from '~/components/threads/store'

/**
 * Message types that render as a chat bubble (`ChatMessageDisplay`) and cluster
 * into same-sender runs, rather than as an email card (`EmailDisplay`) or the
 * boxed fallback card (`MessageDisplay`).
 *
 * An explicit set, deliberately NOT `messageType !== 'EMAIL'` — which is what it
 * would reduce to today, since EMAIL is the only non-conversational type the
 * read path derives (`getMessageTypeFromProvider`). Membership should be an
 * opt-in: inverting the test silently bubbles whatever the enum grows next,
 * and the store's union already carries a vestigial `CALL` that no provider
 * emits. `messageType === 'CHAT'` being the only gate is how SMS ended up
 * first-class everywhere except the renderer.
 *
 * Keyed on the MESSAGE rather than the thread's provider so the timeline can
 * decide per row without resolving the channel.
 */
const BUBBLE_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
  'CHAT',
  'SMS',
  'WHATSAPP',
  'FACEBOOK',
  'INSTAGRAM',
])

/** Whether this message renders as a chat bubble. See {@link BUBBLE_MESSAGE_TYPES}. */
export function isBubbleMessage(messageType: MessageType | string | null | undefined): boolean {
  if (!messageType) return false
  return BUBBLE_MESSAGE_TYPES.has(messageType as MessageType)
}
