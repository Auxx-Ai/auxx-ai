// packages/lib/src/approval-requests/access-request-notifications.ts
//
// The notification funnel for the `access` kind — BOTH instance lanes
// (plan 42 §8, plan v3/04 §3.1).
//
// 🔴 **There is exactly ONE funnel per direction, and it must stay that way.**
// Plan 45 §3.2 has the client clear the requester's "requested" chip off the
// `ACCESS_REQUEST_DECIDED` notification rather than off a second realtime event,
// precisely because one function already covers all three terminal outcomes.
// A second lane growing its own copy would strand the chip on whichever outcome
// lost its notification — so the lanes pass their vocabulary in as parameters
// rather than forking the body.

import type { Database } from '@auxx/database'
import type { Rung } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { NotificationService } from '../notifications/notification-service'

const logger = createScopedLogger('approval-requests')

/** What the two lanes differ by — everything else about the payload is shared. */
interface AccessNotificationVocabulary {
  /**
   * `entityDefinitionId` as persisted: the literal slug `'thread'` for the mail
   * lane, a canonical `EntityDefinition.id` for the record lane. It is also what
   * the renderer discriminates on, since the two ladders share value names
   * (`read` is the TOP of mail's and the BOTTOM of the record ladder).
   */
  resourceKey: string
  /**
   * The DEF/AREA-axis value, when the lane populates it. The thread lane still
   * writes the old `(view, rung)` pair; the record lane leaves it NULL and lets
   * the rung be authoritative (§2.2).
   */
  requestedLevel?: 'none' | 'view' | 'edit' | 'admin'
}

/**
 * Tell the approvers a request is waiting.
 *
 * `targetType: 'APPROVAL'` with `{ approvalRequestId }` — deliberately NOT a
 * `THREAD` or `ENTITY_INSTANCE` target: routing an approver to the thing instead
 * of the decision is a worse action, and half of them may not be able to read it.
 *
 * The requester is filtered out of the audience. Under the record lane's D3
 * resolver they can genuinely be in it — an org admin may hold `read` on a def
 * they cannot edit and ask for `edit` — and "you asked for access" in your own
 * bell is noise.
 */
export async function notifyAccessApprovers(
  db: Database,
  params: AccessNotificationVocabulary & {
    organizationId: string
    requesterId: string
    approvalRequestId: string
    approverUserIds: string[]
    subjectLabel: string
    requestedRung: Rung
    reRequest: boolean
  }
): Promise<void> {
  if (params.approverUserIds.length === 0) return
  try {
    const service = new NotificationService(db)
    await Promise.all(
      params.approverUserIds
        .filter((userId) => userId !== params.requesterId)
        .map((userId) =>
          service.sendNotification({
            type: 'ACCESS_REQUESTED',
            userId,
            organizationId: params.organizationId,
            actorId: params.requesterId,
            targetType: 'APPROVAL',
            targetIds: { approvalRequestId: params.approvalRequestId },
            message: params.reRequest
              ? `Reminder: access requested for ${params.subjectLabel}`
              : `Access requested for ${params.subjectLabel}`,
            metadata: {
              kind: 'ACCESS_REQUESTED',
              subjectLabel: params.subjectLabel,
              targetKind: 'instance',
              resourceKey: params.resourceKey,
              requestedLevel: params.requestedLevel,
              requestedLens: params.requestedRung,
              reRequest: params.reRequest,
            },
          })
        )
    )
  } catch (error) {
    // Best-effort: the pending row is already the source of truth for the badge.
    logger.warn('Failed to notify access-request approvers', {
      approvalRequestId: params.approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Tell the requester what happened. Also the DENIED requester's only history row. */
export async function notifyRequesterDecided(
  db: Database,
  params: AccessNotificationVocabulary & {
    organizationId: string
    requesterId: string
    approverUserId: string
    approvalRequestId: string
    subjectLabel: string
    decision: 'approved' | 'denied' | 'superseded'
    /** Only on `approved` — what was actually written. */
    grantedRung?: Rung
    grantedLevel?: 'none' | 'view' | 'edit' | 'admin'
  }
): Promise<void> {
  const copy: Record<typeof params.decision, string> = {
    approved: `Your access request for ${params.subjectLabel} was approved`,
    denied: `Your access request for ${params.subjectLabel} was declined`,
    superseded: `You already have access to ${params.subjectLabel}`,
  }
  const approved = params.decision === 'approved'
  try {
    await new NotificationService(db).sendNotification({
      type: 'ACCESS_REQUEST_DECIDED',
      userId: params.requesterId,
      organizationId: params.organizationId,
      actorId: params.approverUserId,
      targetType: 'APPROVAL',
      targetIds: { approvalRequestId: params.approvalRequestId },
      message: copy[params.decision],
      metadata: {
        kind: 'ACCESS_REQUEST_DECIDED',
        subjectLabel: params.subjectLabel,
        targetKind: 'instance',
        resourceKey: params.resourceKey,
        decision: params.decision,
        grantedLevel: approved ? params.grantedLevel : undefined,
        grantedLens: approved ? params.grantedRung : undefined,
      },
    })
  } catch (error) {
    logger.warn('Failed to notify access-request requester', {
      approvalRequestId: params.approvalRequestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
