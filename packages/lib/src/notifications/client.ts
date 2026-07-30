// packages/lib/src/notifications/client.ts
// Client-safe types and constants for the notifications feature.

import type { Rung } from '@auxx/database/enums'
import type { NotificationType } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'

export const NOTIFICATION_TARGET_TYPES = [
  'ENTITY_INSTANCE',
  'THREAD',
  'TASK',
  'COMMENT',
  'APPROVAL',
  'DATASET',
  'KNOWLEDGE_BASE',
  'DASHBOARD',
  'WORKFLOW',
  'AGENT',
  'SIGNATURE',
  'SNIPPET',
  'INBOX',
  'SETTINGS',
  'NONE',
] as const

export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number]

/** Per-type targetIds shape — the only place compound IDs are formalized in TS. */
export interface NotificationTargetIdsMap {
  ENTITY_INSTANCE: { entityDefinitionId: string; entityInstanceId: string }
  THREAD: { threadId: string; inboxId?: string }
  TASK: { taskId: string }
  /** `recordId` is the parent record the comment belongs to. */
  COMMENT: { commentId: string; recordId: RecordId }
  APPROVAL: { approvalRequestId: string }
  DATASET: { datasetId: string }
  KNOWLEDGE_BASE: { knowledgeBaseId: string }
  DASHBOARD: { dashboardId: string }
  /** The `WorkflowApp.id` — the instance-access key `workflow` is keyed on it. */
  WORKFLOW: { workflowAppId: string }
  /** The `Agent.id`. Deep links route by SLUG, so the renderer resolves it. */
  AGENT: { agentId: string }
  /** The signature's `EntityInstance.id` — signatures are entity instances. */
  SIGNATURE: { signatureId: string }
  /** The `Snippet.id`. */
  SNIPPET: { snippetId: string }
  /**
   * The inbox's `EntityInstance.id` — inboxes are entity instances, like
   * signatures. ONE target type for BOTH mail instance-access keys (`inbox` and
   * `personal_inbox`): the def is an authorization distinction, not a routing
   * one — every inbox deep-links the same way — and `resourceKey` on the
   * `RESOURCE_SHARED` metadata below already carries which kind it was.
   */
  INBOX: { inboxId: string }
  SETTINGS: { path: string }
  NONE: Record<string, never>
}

export type NotificationTargetIds<T extends NotificationTargetType = NotificationTargetType> =
  NotificationTargetIdsMap[T]

export type NotificationMetadata =
  | { kind: 'COMMENT_MENTION'; recordName?: string; snippet?: string }
  | { kind: 'COMMENT_REPLY'; recordName?: string; snippet?: string }
  | { kind: 'COMMENT_REACTION'; recordName?: string; reaction?: string }
  | { kind: 'TASK_ASSIGNED'; taskTitle: string; deadline?: string | null }
  | { kind: 'TASK_DEADLINE'; taskTitle?: string; deadline?: string | null }
  | { kind: 'TASK_AUTO_COMPLETED'; taskTitle?: string }
  | {
      kind: 'RESOURCE_SHARED'
      resourceName: string
      noun: string
      /** Mirrors `InstanceAccessKey` — kept as a literal union so this module stays client-safe. */
      resourceKey:
        | 'dataset'
        | 'kb'
        | 'dashboard'
        | 'workflow'
        | 'agent'
        | 'signature'
        | 'snippet'
        | 'inbox'
        | 'personal_inbox'
      level: 'read' | 'write' | 'full'
    }
  | { kind: 'MESSAGE_SHARED'; subject?: string | null; lens: string }
  // Access requests (plans/permissions/v2/28 §7, 42 §8). `ResourcePermission`
  // vocabulary (`none|view|edit|admin`), deliberately NOT `RESOURCE_SHARED`'s stale
  // `'read'|'write'|'full'` — do not propagate that shape into new variants.
  | {
      kind: 'ACCESS_REQUESTED'
      /** The server-built durable label (plan 42 §7) — never client-authored. */
      subjectLabel: string
      targetKind: 'area' | 'def' | 'instance'
      /**
       * Definition key for def/instance targets: the literal `'thread'` slug for
       * the mail lane, a canonical `EntityDefinition.id` for the record lane —
       * which is also how a renderer tells the two apart. It has to: `read` is
       * the TOP of mail's ladder ("Full access") and the BOTTOM of the record
       * ladder ("Read access"), so one label map over both silently rewords one
       * of them (plan v3/04 §8.1).
       */
      resourceKey?: string
      requestedLevel?: 'none' | 'view' | 'edit' | 'admin'
      /**
       * The instance {@link Rung} asked for. Widened from the mail-only
       * `'metadata' | 'identity' | 'read'` by plan v3/04: this is a SEPARATE type
       * from `ApprovalRequest.requestedLens`'s column type, so the schema's own
       * widening did not reach it, and the record lane writing `'edit'` would
       * have been a type error here.
       *
       * ⚠ The `Lens` in the name is the same historical residual the column
       * carries — read it as "instance rung".
       */
      requestedLens?: Rung
      /** True when this is a re-ask that bumped `metadata.remindedAt` rather than a new row. */
      reRequest?: boolean
    }
  | {
      kind: 'ACCESS_REQUEST_DECIDED'
      subjectLabel: string
      targetKind: 'area' | 'def' | 'instance'
      resourceKey?: string
      /**
       * `superseded` is not a decision the approver made — it is "access already
       * arrived another way", which the requester needs told differently from an
       * approval they can act on.
       */
      decision: 'approved' | 'denied' | 'timeout' | 'superseded'
      grantedLevel?: 'none' | 'view' | 'edit' | 'admin'
      /** The instance {@link Rung} actually written. See `requestedLens` above. */
      grantedLens?: Rung
    }
  | {
      kind:
        | 'WORKFLOW_APPROVAL_REQUIRED'
        | 'WORKFLOW_APPROVAL_REMINDER'
        | 'WORKFLOW_APPROVAL_COMPLETED'
      workflowName?: string
      [key: string]: unknown
    }
  | { kind: 'SYSTEM_MESSAGE'; [key: string]: unknown }
  | {
      kind: 'WORK_ORDER_DISPATCHED' | 'VISIT_RESCHEDULED' | 'VISIT_CANCELED' | 'VISIT_REASSIGNED'
      visitId?: string
    }

/** Fallback icon config shared by every notification surface. */
export const NOTIFICATION_ICON_MAP: Record<NotificationType, { iconId: string; color: string }> = {
  COMMENT_MENTION: { iconId: 'user', color: 'blue' },
  COMMENT_REPLY: { iconId: 'message-square', color: 'green' },
  COMMENT_REACTION: { iconId: 'heart', color: 'pink' },
  TICKET_ASSIGNED: { iconId: 'ticket', color: 'indigo' },
  TICKET_UPDATED: { iconId: 'ticket', color: 'teal' },
  TICKET_MENTIONED: { iconId: 'user', color: 'purple' },
  THREAD_ACTIVITY: { iconId: 'message-circle', color: 'teal' },
  THREAD_SHARED: { iconId: 'share-2', color: 'blue' },
  SYSTEM_MESSAGE: { iconId: 'info', color: 'gray' },
  WORKFLOW_APPROVAL_REQUIRED: { iconId: 'check-circle', color: 'orange' },
  WORKFLOW_APPROVAL_REMINDER: { iconId: 'bell-ring', color: 'orange' },
  WORKFLOW_APPROVAL_COMPLETED: { iconId: 'check-circle', color: 'green' },
  TASK_DEADLINE: { iconId: 'clock', color: 'orange' },
  WORK_ORDER_DISPATCHED: { iconId: 'truck', color: 'blue' },
  VISIT_RESCHEDULED: { iconId: 'calendar-clock', color: 'orange' },
  VISIT_CANCELED: { iconId: 'ban', color: 'red' },
  VISIT_REASSIGNED: { iconId: 'truck', color: 'indigo' },
  TASK_AUTO_COMPLETED: { iconId: 'check-circle', color: 'green' },
  TASK_ASSIGNED: { iconId: 'clipboard-check', color: 'blue' },
  RESOURCE_SHARED: { iconId: 'share-2', color: 'blue' },
  MESSAGE_SHARED: { iconId: 'mail', color: 'blue' },
  ACCESS_REQUESTED: { iconId: 'lock-keyhole', color: 'orange' },
  ACCESS_REQUEST_DECIDED: { iconId: 'lock-keyhole-open', color: 'green' },
}

export const DEFAULT_NOTIFICATION_ICON = { iconId: 'bell', color: 'gray' }

/** Notification row returned by the notification router. */
export interface NotificationEntity<T extends NotificationTargetType = NotificationTargetType> {
  id: string
  type: NotificationType
  message: string
  targetType: T
  targetIds: NotificationTargetIdsMap[T]
  isRead: boolean
  createdAt: Date
  readAt: Date | null
  userId: string
  actorId: string | null
  organizationId: string
  deliveredAt: Date | null
  deliveryMethod: string | null
  metadata: NotificationMetadata | null
  actor: { id: string; name: string | null; image: string | null } | null
}
