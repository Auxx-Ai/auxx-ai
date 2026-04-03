// apps/worker/src/workers/worker-definitions/ai-agent-worker.ts

import { processAgentMessage } from '@auxx/lib/ai/agent-framework'
import { Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { createWorker } from '../utils/createWorker'

const logger = createScopedLogger('worker:ai-agent')

const aiAgentJobMappings = {
  processAgentMessage,
}

/**
 * Starts a BullMQ worker for the AI agent queue.
 * Processes Kopilot and Builder agent session messages.
 */
export function startAiAgentWorker() {
  logger.info(`Starting worker for queue: ${Queues.aiAgentQueue}`)

  return createWorker(Queues.aiAgentQueue, aiAgentJobMappings, {
    concurrency: 5,
  })
}
