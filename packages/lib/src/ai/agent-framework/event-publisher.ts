// packages/lib/src/ai/agent-framework/event-publisher.ts

import { RedisEventRouter } from '@auxx/redis'
import type { AgentEvent } from './types'

const CHANNEL_PREFIX = 'agent:session'

/**
 * Create a publisher that sends agent events to a session-specific Redis channel.
 * Used by the worker to relay events to the SSE subscriber.
 */
export function createAgentEventPublisher(sessionId: string) {
  const router = RedisEventRouter.getInstance('agent-events')
  const channel = `${CHANNEL_PREFIX}:${sessionId}`

  return {
    publish: (event: AgentEvent | { type: string; [key: string]: unknown }) =>
      router.publish(channel, event),
    channel,
  }
}

/**
 * Subscribe to agent events for a specific session.
 * Used by the SSE route in worker-dispatch mode to relay events to the client.
 */
export async function subscribeToAgentEvents(
  sessionId: string,
  handler: (event: AgentEvent) => void | Promise<void>
): Promise<{ handlerId: string; router: RedisEventRouter }> {
  const router = RedisEventRouter.getInstance('agent-events')
  const handlerId = await router.subscribe({
    pattern: `${CHANNEL_PREFIX}:${sessionId}`,
    handler,
    metadata: { type: 'agent', sessionId },
  })
  return { handlerId, router }
}
