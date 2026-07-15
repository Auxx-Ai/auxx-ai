// packages/lib/src/sequences/subject.ts
// Subject-scoped guards + resolution for the sequence-send-email node (client-notifications
// plan §4.4 (2)/(3)): "is this subject still worth sending to" and "who do we send to right
// now". Shares the `AnchorSubjectKind` union with `anchor.ts` — both read the same three
// subject shapes (visit / work_order / invoice).

import { type Database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { UnifiedCrudHandler } from '../resources/crud'
import { SystemUserService } from '../users/system-user-service'
import { type AnchorSubjectKind, computeAnchorTarget, resolveSubjectAnchorDate } from './anchor'

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

function relationshipRecordId(typed: TypedFieldValue | undefined): RecordId | undefined {
  return typed?.type === 'relationship' ? typed.recordId : undefined
}

export type SubjectGuardOutcome =
  /** Subject in good standing (or a manual/contact-only run) — proceed to send. */
  | { action: 'proceed' }
  /** Skip THIS step only — run stays active, the next compiled step still fires. */
  | { action: 'skip'; reason: string }
  /** Exit the whole run — one of the client-notifications exit reasons. */
  | { action: 'exit'; reason: 'canceled' | 'completed_subject' | 'paid' }

/**
 * Combined subject-state + live-anchor-recompute guard (client-notifications plan §4.4
 * (1)+(2)). Runs `(2)` state checks first (which double as the "subject row missing" check
 * for BOTH guards — a deleted visit/invoice fails here before an anchor-mode step ever tries
 * to compute a target against it), then `(1)`'s anchor recompute for anchor-mode steps only.
 *
 * Anchor-moved-to-the-future note: the engine's pause/resume model always marks a resumed
 * node "completed" and advances to the next one (`workflow-engine.ts`'s `resumeExecution`) —
 * there is no primitive to re-pause the SAME node once its `executeNode` has started running.
 * A genuine "re-sleep to the new target" therefore isn't implementable from inside this node
 * without deeper engine surgery (see the Phase 1 report). Anchors far enough in the future
 * are treated the same as past ones: skip this send rather than fire it early or late — the
 * `reanchorSequenceRuns` hook (§4.2) is the real fix path and should catch this before it ever
 * reaches the send node for the common case (visit reschedule / invoice due-date edit).
 */
export async function evaluateSubjectGuards(
  db: Database,
  organizationId: string,
  subject: { subjectKind: AnchorSubjectKind | null; subjectId: string | null },
  triggerType: string,
  step:
    | { timingMode: string; anchorOffsetDays: number; anchorTimeOfDay: string | null }
    | undefined,
  deliveryTimezone: string | null
): Promise<SubjectGuardOutcome> {
  const { subjectKind, subjectId } = subject
  if (!subjectKind || !subjectId) return { action: 'proceed' } // manual / contact-only run

  if (subjectKind === 'invoice') {
    const entity = await db.query.EntityInstance.findFirst({
      where: and(
        eq(schema.EntityInstance.id, subjectId),
        eq(schema.EntityInstance.organizationId, organizationId)
      ),
      columns: { id: true },
    })
    if (!entity) return { action: 'exit', reason: 'canceled' }

    const cf = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['invoice_status', 'invoice_balance'] as const)
    const fieldIds = [cf.invoice_status, cf.invoice_balance].filter(Boolean).map((f) => f!.id)
    if (fieldIds.length > 0) {
      const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
      const handler = new UnifiedCrudHandler(organizationId, systemUserId, db)
      const values = await handler.getFieldValues(toRecordId('invoice', subjectId), fieldIds)
      const statusTyped = cf.invoice_status
        ? firstTyped(values.get(cf.invoice_status.id))
        : undefined
      const status = statusTyped ? (extractValue(statusTyped) as string) : undefined
      const balanceTyped = cf.invoice_balance
        ? firstTyped(values.get(cf.invoice_balance.id))
        : undefined
      const balance = balanceTyped ? (extractValue(balanceTyped) as number) : undefined
      if (status === 'paid' || status === 'void' || (balance !== undefined && balance <= 0)) {
        return { action: 'exit', reason: 'paid' }
      }
    }
  } else if (subjectKind === 'visit') {
    const visit = await db.query.WorkOrderVisit.findFirst({
      where: and(
        eq(schema.WorkOrderVisit.id, subjectId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      ),
      columns: { status: true, startTime: true, recurrenceRuleId: true },
    })
    if (!visit) return { action: 'exit', reason: 'canceled' }
    if (visit.status === 'canceled' || !visit.startTime)
      return { action: 'exit', reason: 'canceled' }
    if (visit.status === 'done' && triggerType === 'visit:scheduled') {
      return { action: 'exit', reason: 'completed_subject' }
    }
    // Recurring-born rule (client-notifications plan §4.3/§4.10, decision #13) —
    // `visit:scheduled` ONLY: a recurring-born visit (materialized with `startTime` already
    // set, never through `scheduleVisit`) gets anchored reminders only. Enrollment already
    // excludes a fully-past/recurring-skipped run from ever starting
    // (`enrollSubjectInSequence`); this is the per-step enforcement for the (rare) case a
    // relative step still ends up compiled ahead of an anchor step in the same run.
    if (
      triggerType === 'visit:scheduled' &&
      visit.recurrenceRuleId &&
      step &&
      step.timingMode !== 'anchor'
    ) {
      return { action: 'skip', reason: 'recurring-born-immediate-skip' }
    }
  } else if (subjectKind === 'work_order') {
    const entity = await db.query.EntityInstance.findFirst({
      where: and(
        eq(schema.EntityInstance.id, subjectId),
        eq(schema.EntityInstance.organizationId, organizationId)
      ),
      columns: { id: true },
    })
    if (!entity) return { action: 'exit', reason: 'canceled' }
  }

  if (step?.timingMode === 'anchor') {
    const { anchorDate } = await resolveSubjectAnchorDate(
      db,
      organizationId,
      subjectKind,
      subjectId
    )
    const timezone = deliveryTimezone ?? 'UTC'
    const target = computeAnchorTarget(
      anchorDate,
      { offsetDays: step.anchorOffsetDays, timeOfDay: step.anchorTimeOfDay },
      timezone
    )
    // Small forward tolerance absorbs normal job-scheduling jitter around the intended
    // moment without treating a genuinely-moved-out anchor as "on time".
    const toleranceMs = 5 * 60 * 1000
    if (!target || target.getTime() > Date.now() + toleranceMs) {
      return { action: 'skip', reason: !target ? 'null-anchor' : 'anchor-moved-to-future' }
    }
  }

  return { action: 'proceed' }
}

export interface SubjectContext {
  contactRecordId?: RecordId
  workOrderInstanceId?: string
  /** Only populated for a visit subject; `recurrenceRuleId`/`occurrenceDate` feed the signal
   * metadata (§4.10's future dedup key). */
  visit?: {
    id: string
    startTime: Date | null
    endTime: Date | null
    assigneeUserId: string | null
    recurrenceRuleId: string | null
    occurrenceDate: string | null
  }
}

/**
 * Resolve a subject's linked contact + work order (client-notifications plan §4.4 (3) — the
 * "subject → work_order → contact" chain) — shared by send-time recipient resolution and the
 * `EntitySignal` link builder, so both walk the exact same relationships.
 */
export async function resolveSubjectContext(
  db: Database,
  organizationId: string,
  systemUserId: string,
  subjectKind: AnchorSubjectKind,
  subjectId: string
): Promise<SubjectContext> {
  const cache = getOrgCache()
  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db)

  if (subjectKind === 'invoice') {
    const cf = await cache
      .from(organizationId, 'customFields')
      .bySystemAttributes(['invoice_contact', 'invoice_work_order'] as const)
    const fieldIds = [cf.invoice_contact, cf.invoice_work_order].filter(Boolean).map((f) => f!.id)
    if (fieldIds.length === 0) return {}
    const values = await handler.getFieldValues(toRecordId('invoice', subjectId), fieldIds)
    const contactRecordId = cf.invoice_contact
      ? relationshipRecordId(firstTyped(values.get(cf.invoice_contact.id)))
      : undefined
    const workOrderRecordId = cf.invoice_work_order
      ? relationshipRecordId(firstTyped(values.get(cf.invoice_work_order.id)))
      : undefined
    return {
      contactRecordId,
      workOrderInstanceId: workOrderRecordId
        ? parseRecordId(workOrderRecordId).entityInstanceId
        : undefined,
    }
  }

  let workOrderInstanceId: string | undefined
  let visit: SubjectContext['visit']
  if (subjectKind === 'visit') {
    const row = await db.query.WorkOrderVisit.findFirst({
      where: and(
        eq(schema.WorkOrderVisit.id, subjectId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      ),
      columns: {
        id: true,
        workOrderId: true,
        startTime: true,
        endTime: true,
        assigneeUserId: true,
        recurrenceRuleId: true,
        occurrenceDate: true,
      },
    })
    workOrderInstanceId = row?.workOrderId
    if (row)
      visit = {
        id: row.id,
        startTime: row.startTime,
        endTime: row.endTime,
        assigneeUserId: row.assigneeUserId,
        recurrenceRuleId: row.recurrenceRuleId,
        occurrenceDate: row.occurrenceDate,
      }
  } else {
    workOrderInstanceId = subjectId
  }
  if (!workOrderInstanceId) return { visit }

  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['work_order_contact'] as const)
  if (!cf.work_order_contact) return { workOrderInstanceId, visit }
  const values = await handler.getFieldValues(toRecordId('work_order', workOrderInstanceId), [
    cf.work_order_contact.id,
  ])
  const contactRecordId = relationshipRecordId(firstTyped(values.get(cf.work_order_contact.id)))
  return { contactRecordId, workOrderInstanceId, visit }
}

/** Send-time recipient email for a subject-scoped run (decision #15) — resolves the CURRENT
 * contact via `resolveSubjectContext`, not the email frozen at enrollment. Null when no
 * contact/email is linked right now (caller should skip the step, not exit the run). */
export async function resolveSubjectRecipientEmail(
  db: Database,
  organizationId: string,
  systemUserId: string,
  subjectKind: AnchorSubjectKind,
  subjectId: string
): Promise<{ email: string; contactRecordId: RecordId } | null> {
  const context = await resolveSubjectContext(
    db,
    organizationId,
    systemUserId,
    subjectKind,
    subjectId
  )
  if (!context.contactRecordId) return null

  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db)
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['primary_email'] as const)
  if (!cf.primary_email) return null
  const values = await handler.getFieldValues(context.contactRecordId, [cf.primary_email.id])
  const emailTyped = firstTyped(values.get(cf.primary_email.id))
  const email = emailTyped ? (extractValue(emailTyped) as string) : undefined
  if (!email) return null

  return { email, contactRecordId: context.contactRecordId }
}
