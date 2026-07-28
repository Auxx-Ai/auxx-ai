// apps/web/src/server/lib/webhook-test-window.ts

import { getRedisClient } from '@auxx/redis'

/**
 * Lifetime of a webhook draft-test session, in seconds.
 *
 * Deliberately ONE constant for two things that must agree: the captured-event
 * list (`webhook:test:<id>:events`, which the route re-expires on every write)
 * and the arm window below. A window that outlived the event list would accept
 * draft executions nobody is watching; a shorter one would stop accepting while
 * the editor still shows a live list.
 */
export const WEBHOOK_TEST_WINDOW_TTL_SECONDS = 300

/** Redis list of captured test events — read by the editor's SSE poll route. */
export const webhookTestEventsKey = (workflowId: string) => `webhook:test:${workflowId}:events`

/** Redis flag that a listening window is currently open for this workflow. */
export const webhookTestArmKey = (workflowId: string) => `webhook:test:${workflowId}:armed`

/**
 * Open a draft-test listening window for `workflowId`.
 *
 * Callers MUST have already asserted instance `edit` on the workflow — arming
 * is what makes the otherwise-anonymous `POST /api/workflows/<id>/webhook?test=true`
 * execute the org's unpublished graph, so it carries the same authority as
 * running the draft yourself.
 *
 * Uses the *required* Redis client on purpose: if Redis is down, arming must
 * fail loudly rather than hand the user a button that appears to work while
 * {@link isWebhookTestWindowArmed} keeps answering `false`.
 */
export async function armWebhookTestWindow(workflowId: string): Promise<void> {
  const redis = await getRedisClient(true)
  await redis?.set(webhookTestArmKey(workflowId), '1', 'EX', WEBHOOK_TEST_WINDOW_TTL_SECONDS)
}

/**
 * Is a draft-test listening window currently open for `workflowId`?
 *
 * **Fails CLOSED.** An unreachable Redis answers `false`, so `?test=true` falls
 * back to behaving as if no draft test path existed. Failing open would restore
 * the exact hole this gate closes — anonymous execution of an org's unpublished
 * graph — under a condition (Redis unavailable) that is neither rare nor
 * something a caller has to be trusted to avoid. Nothing of value is lost by
 * closing: the whole test surface is Redis-backed, so with Redis down the
 * captured events could not be stored or streamed to the editor anyway.
 */
export async function isWebhookTestWindowArmed(workflowId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient(false)
    if (!redis) return false
    return (await redis.exists(webhookTestArmKey(workflowId))) > 0
  } catch {
    return false
  }
}
