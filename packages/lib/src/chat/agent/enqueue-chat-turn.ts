// packages/lib/src/chat/agent/enqueue-chat-turn.ts

import { getQueue, Queues } from '../../jobs/queues'

/** Payload for one visitor chat turn, processed by `processChatTurn`. */
export interface ChatTurnJobPayload {
  organizationId: string
  /** The chat-kind agent bound to the widget. */
  agentId: string
  /** The chat `Thread` the visitor messaged on. */
  threadId: string
  /**
   * The `Participant` that sent the inbound message — the subject's
   * `participant` anchor (plans/chat/v8 phase-1).
   */
  participantId: string
  /** Verified contact id, baked from a crypto-verified passport; else null. */
  contactId: string | null
  /** `true` only when the passport was minted with a valid customer JWT. */
  identityVerified: boolean
  /** Untrusted `identify()` claim — display only, never an anchor. */
  claimed?: { name?: string; email?: string }
  /** The inbound `Message` that triggered this turn (fed to the engine). */
  inboundMessageId: string
}

/** Job name the chat-agent worker maps to `processChatTurn`. */
export const CHAT_TURN_JOB_NAME = 'processChatTurn'

/**
 * Enqueue a visitor chat turn onto the dedicated `chat-agent` queue.
 *
 * **Per-thread serialization rides `jobId = chat-turn:{threadId}`** — while a
 * turn for a thread is waiting/active, BullMQ ignores a second add with the
 * same id, so at most one turn per thread runs at a time. A second visitor
 * message that lands mid-turn is therefore not a new job; the in-flight turn's
 * catchup-replay folds it in. `removeOnComplete: true` frees the id the moment
 * a turn finishes, so the next message enqueues normally.
 *
 * Retries are safe: `findOrCreateThreadSession` + catchup-replay make a re-run
 * resume cleanly, and the reply write is guarded against double-posting
 * (phase-3b §6).
 */
export async function enqueueChatTurn(payload: ChatTurnJobPayload) {
  const queue = getQueue(Queues.chatAgentQueue)
  return queue.add(CHAT_TURN_JOB_NAME, payload, {
    jobId: `chat-turn:${payload.threadId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: { count: 100 },
  })
}
