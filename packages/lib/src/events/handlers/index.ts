import type { IEventsHandlers } from '../types'
import { createTimelineEvent } from './create-timeline-event'
import { sendInvitationUserJob } from './send-invitation-user-job'
import { triggerResourceWorkflows } from './trigger-resource-workflows'
import { updateWebhookLastTriggeredAt } from './update-webhook-last-triggered'

export const EventHandlers: IEventsHandlers = {
  // user events
  'user:created': [],
  'project:created': [],

  'membership:created': [sendInvitationUserJob],

  // Ticket events → CREATE TIMELINE
  'ticket:created': [createTimelineEvent, triggerResourceWorkflows],
  'ticket:updated': [createTimelineEvent, triggerResourceWorkflows],
  'ticket:deleted': [triggerResourceWorkflows],
  'ticket:status:changed': [createTimelineEvent],
  'ticket:assignee:added': [],
  'ticket:assignee:removed': [],
  'ticket:reply:created': [],

  // message events → CREATE TIMELINE
  'message:received': [createTimelineEvent],
  'message:sent': [createTimelineEvent],
  'message:failed': [],
  'message:comment:created': [],
  'message:assignee:changed': [],
  'message:tag:added': [],
  'message:tag:removed': [],

  // thread events
  'thread:moved': [],
  'thread:archived': [],
  'thread:deleted': [],
  'thread:reopened': [],
  'thread:restored': [],

  'messages:sync:pending': [],
  'messages:sync:processing': [],
  'messages:sync:complete': [],
  'messages:sync:failed': [],

  'message:processing:started': [],
  'message:processing:completed': [],
  'message:processing:failed': [],

  'message:bulk:processing:started': [],
  'message:bulk:processing:completed': [],
  'message:bulk:processing:failed': [],

  'workflow:paused': [],
  'workflow:resumed': [],
  'workflow:resume:failed': [],

  // approval events
  'approval:created': [],
  'approval:responded': [],
  'approval:cancelled': [],
  'approval:timeout': [],

  // webhook events
  'webhook:delivery:created': [updateWebhookLastTriggeredAt],

  // Contact events → CREATE TIMELINE + TRIGGER WORKFLOWS
  'contact:created': [createTimelineEvent, triggerResourceWorkflows],
  'contact:updated': [createTimelineEvent, triggerResourceWorkflows],
  'contact:deleted': [createTimelineEvent, triggerResourceWorkflows],
  'contact:merged': [createTimelineEvent],
  'contact:field:updated': [createTimelineEvent],
  'contact:group:added': [createTimelineEvent],
  'contact:group:removed': [createTimelineEvent],

  // Comment events → CREATE TIMELINE
  'comment:created': [createTimelineEvent],
  'comment:updated': [createTimelineEvent],
  'comment:deleted': [createTimelineEvent],
  'comment:replied': [createTimelineEvent],

  // Entity instance events → CREATE TIMELINE
  'entity:created': [createTimelineEvent],
  'entity:updated': [createTimelineEvent],
  'entity:deleted': [createTimelineEvent],

  // Integration events (analytics-only, no handlers needed)
  'integration:connected': [],
  'integration:connection_failed': [],
  'shopify:connected': [],
}

// passwordReset, systemNotification, userNotification
