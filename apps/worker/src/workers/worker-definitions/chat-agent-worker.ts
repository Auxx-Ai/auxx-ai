// apps/worker/src/workers/worker-definitions/chat-agent-worker.ts

import { database } from '@auxx/database'
import { getCachedAgentById } from '@auxx/lib/cache'
import { sendAgentChatMessage } from '@auxx/lib/chat'
import { type ChatTurnJobPayload, flipHandoffState, processChatTurn } from '@auxx/lib/chat/agent'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:chat-agent')

const chatAgentJobMappings = {
  processChatTurn,
}

const TERMINAL_FAILURE_REPLY =
  "Sorry, I'm having trouble right now — a teammate will follow up shortly."

/**
 * Dedicated worker for visitor chat turns, isolated from the shared `ai-agent`
 * pool so a burst elsewhere can't delay a live reply. On terminal failure
 * (BullMQ retries exhausted) it posts an apology and hands the thread to a
 * human so it surfaces in the queue. See plans/chat/v5 phase-3b §6.
 */
export function startChatAgentWorker() {
  logger.info(`Starting worker for queue: ${Queues.chatAgentQueue}`)

  const worker = createWorker(Queues.chatAgentQueue, chatAgentJobMappings, {
    // Chat is the one path with a live human on a ~2–3s budget; give it its
    // own headroom rather than sharing ai-agent's concurrency of 5.
    concurrency: 10,
  })

  worker.on('failed', async (job, error) => {
    if (!job) return
    const maxAttempts = job.opts.attempts ?? 1
    // Fires on every failed attempt — only act once retries are exhausted.
    if (job.attemptsMade < maxAttempts) return

    const { organizationId, agentId, threadId } = job.data as ChatTurnJobPayload
    logger.error('Chat turn terminally failed — escalating to human', {
      threadId,
      organizationId,
      error: error.message,
    })
    try {
      const agent = await getCachedAgentById(organizationId, agentId)
      if (agent?.userId) {
        await sendAgentChatMessage(
          { db: database, organizationId },
          { threadId, agentUserId: agent.userId, content: TERMINAL_FAILURE_REPLY }
        )
      }
      await flipHandoffState({
        threadId,
        organizationId,
        source: 'worker_failure',
        actor: { kind: 'system' },
      })
    } catch (escalationError) {
      logger.error('Failed to escalate terminally-failed chat turn', {
        threadId,
        error: escalationError instanceof Error ? escalationError.message : String(escalationError),
      })
    }
  })

  return worker
}
