// packages/lib/src/chat/agent/enqueue-chat-turn.ts

import { getQueue, Queues } from '../../jobs/queues'

/** Payload for one visitor chat turn, processed by `processChatTurn`. */
export interface ChatTurnJobPayload {
  organizationId: string
  /** The chat-kind agent bound to the widget. */
  agentId: string
  /** The chat `Thread` the visitor messaged on. */
  threadId: string
  /** Verified contact id, when the visitor has been promoted; else null. */
  contactId: string | null
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
