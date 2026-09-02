// packages/lib/src/jobs/webhooks/webhook-events.ts
//
// Leaf module: the event types that fan out to customer webhooks. Kept free of
// runtime imports so `events/publisher.ts` can consult it without pulling the
// database-backed webhook job into every publisher call site.

import type { Events } from '../../events/types'

/** Event types customers may subscribe a webhook to. */
export const WEBHOOK_EVENTS: Array<Events> = [
  'user:created',
  'project:created',
  'membership:created',
  'ticket:created',
  'ticket:updated',
  'ticket:deleted',
  'ticket:status:changed',
  'ticket:assignee:added',
  'ticket:assignee:removed',
  'ticket:reply:created',

  // message events
  'message:received',
  'message:sent',
  'message:failed',
  'message:comment:created',
  'message:assignee:changed',
  'message:tag:added',
  'message:tag:removed',

  // thread events
  'thread:moved',
  'thread:archived',
  'thread:deleted',
  'thread:reopened',
  'thread:restored',

  // workflow events
  'workflow:paused',
  'workflow:resumed',
  'workflow:resume:failed',
]

const WEBHOOK_EVENT_SET = new Set<string>(WEBHOOK_EVENTS)

/**
 * Whether an event type is in {@link WEBHOOK_EVENTS}. The publisher uses this
 * to skip the webhooks-queue job entirely for the (many) event types no
 * webhook can subscribe to, instead of enqueuing a job that exits early.
 */
export function isWebhookEvent(type: string): boolean {
  return WEBHOOK_EVENT_SET.has(type)
}
