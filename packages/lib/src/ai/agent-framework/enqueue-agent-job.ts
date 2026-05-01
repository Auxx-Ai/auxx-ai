// packages/lib/src/ai/agent-framework/enqueue-agent-job.ts

import { Queues } from '../../jobs/queues/types'
import type { AgentSessionType } from './types'

export interface AgentJobPayload {
  sessionId: string
  organizationId: string
  userId: string
  message: string
  type: 'message' | 'approval'
  /** Domain type: 'kopilot' | 'builder' */
  domain: AgentSessionType
  /** Page context for tool resolution */
  page?: string
  context?: Record<string, unknown>
  /** Approval action — required when type is 'approval' */
  approvalAction?: 'approve' | 'reject'
  /** Input amendment for approval (e.g. { mode: 'draft' }) */
  inputAmendment?: Record<string, unknown>
  /** Model override in "provider:model" format — omit to use system default */
  modelId?: string
}

/**
 * Enqueue an agent processing job to the AI agent queue.
 * Uses dynamic import to avoid pulling BullMQ into non-worker contexts.
 */
export async function enqueueAgentJob(payload: AgentJobPayload) {
  const { getQueue } = await import('../../jobs/queues')
  const queue = getQueue(Queues.aiAgentQueue)

  return queue.add('processAgentMessage', payload, {
    attempts: 1, // No auto-retry — would re-run tools
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
    jobId: `agent-${payload.sessionId}-${Date.now()}`,
  })
}
