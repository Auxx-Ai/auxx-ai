// packages/lib/src/evals/worker/publisher.ts
//
// Live delivery for eval runs. Redis is transport, not storage — every event the
// worker publishes is already checkpointed to `EvalRun.trace` / `assertionResults`,
// so a reconnecting SSE client replays the durable state and then resubscribes
// here. Channel is `eval:run:<runId>`. See conventions.md §8.

import { RedisEventRouter } from '@auxx/redis'
import type { AssertionResult, EvalRunStatus, EvalTraceEvent } from '@auxx/types/evals'

const ROUTER_ID = 'eval-events'

/** The channel a run's live events flow over. */
export function evalRunChannel(runId: string): string {
  return `eval:run:${runId}`
}

/** Events the worker publishes; the SSE route relays them verbatim. */
export type EvalRunEvent =
  | { type: 'trace'; event: EvalTraceEvent }
  | { type: 'status'; status: EvalRunStatus; assertionResults?: AssertionResult[] }
  | { type: 'done' }

export function createEvalRunPublisher(runId: string) {
  const router = RedisEventRouter.getInstance(ROUTER_ID)
  const channel = evalRunChannel(runId)
  return {
    channel,
    publish: (event: EvalRunEvent) => router.publish(channel, event),
  }
}

/** Subscribe to a run's live events (used by the SSE route). Returns the handler id. */
export async function subscribeToEvalRunEvents(
  runId: string,
  handler: (event: EvalRunEvent) => void | Promise<void>
): Promise<{ handlerId: string; router: RedisEventRouter }> {
  const router = RedisEventRouter.getInstance(ROUTER_ID)
  const handlerId = await router.subscribe({
    pattern: evalRunChannel(runId),
    handler: handler as (event: unknown) => void | Promise<void>,
    metadata: { type: 'eval', runId },
  })
  return { handlerId, router }
}
