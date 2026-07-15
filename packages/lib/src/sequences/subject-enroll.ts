// packages/lib/src/sequences/subject-enroll.ts
// Subject enrollment internals (client-notifications plan §4.3/§5 Phase 2) — the shared choke
// point BOTH the event-trigger hooks and the hourly enrollment sweep funnel through.
// `enrollRecipients` (`enroll.ts`) stays the manual-recipients path (contact-only, no
// subject); this is its subject-scoped sibling: visit / work_order / invoice subjects,
// enrolled off an event or swept into the window, one `SequenceRun` per (sequence, subject).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { ok, type Result } from 'neverthrow'
import { getCachedEntityDefId } from '../cache'
import type { ConditionGroup } from '../conditions/types'
import { SystemUserService } from '../users/system-user-service'
import { startSystemWorkflowRun } from '../workflows/system-workflow-run'
import {
  type AnchorSubjectKind,
  computeAnchorTarget,
  isPastAnchor,
  resolveSubjectAnchorDate,
} from './anchor'
import { evaluateEnrollmentFilter } from './enrollment-filter'
import { resolveSubjectContext, resolveSubjectRecipientEmail } from './subject'
import { isSuppressed, normalizeEmail } from './suppression'
import type { SequenceEntity } from './types'

const logger = createScopedLogger('sequences-subject-enroll')

/** `'hook'` = an event just fired (dedup: no ACTIVE run for this subject). `'sweep'` = the
 * hourly sweep (dedup: no run EVER for this subject — else completed runs re-enroll every
 * pass, decision #13). */
export type EnrollSubjectSource = 'hook' | 'sweep'

export type EnrollSubjectOutcome =
  | { status: 'enrolled'; sequenceRunId: string }
  | { status: 'skipped'; reason: string }

export interface EnrollSubjectInSequenceInput {
  organizationId: string
  /** Full sequence row — callers (hooks/sweep) already have it from
   * `getEnabledSequencesForTrigger`/the sweep's own query. */
  sequence: SequenceEntity
  subjectKind: AnchorSubjectKind
  subjectId: string
  source: EnrollSubjectSource
}

/** The enrollment-filter's root entity is work_order for visit/work_order subjects, invoice
 * for invoice subjects (§4.3 — "visit plain-table fields are not filterable in v1"). */
function filterRootEntityKind(subjectKind: AnchorSubjectKind): 'work_order' | 'invoice' {
  return subjectKind === 'invoice' ? 'invoice' : 'work_order'
}

/**
 * Enroll a single subject (visit / work_order / invoice) into a sequence — the guards, in
 * order (cheap first): sequence enabled + published; per-subject dedup (source-dependent);
 * recipient existence (subject → work_order → contact → primary email); suppression (only
 * when `respectSuppression`); the enrollment filter (only when set); past-anchor rule
 * (decision #10 — skip if every step is already behind `now`); recurring-born rule (decision
 * #13 — a recurring-born visit's `relative`/immediate steps don't count toward "any step
 * left" for `visit:scheduled`, enforced again per-step at send time by
 * `evaluateSubjectGuards`). Never throws for an individual subject — every failure path
 * returns a `{status:'skipped', reason}` outcome instead.
 */
export async function enrollSubjectInSequence(
  db: Database,
  input: EnrollSubjectInSequenceInput
): Promise<Result<EnrollSubjectOutcome, Error>> {
  const { organizationId, sequence, subjectKind, subjectId, source } = input

  if (sequence.status !== 'enabled' || !sequence.publishedAt) {
    return ok({ status: 'skipped', reason: 'Sequence not enabled/published' })
  }

  // Per-subject dedup — cheapest DB round-trip before anything heavier.
  if (source === 'hook') {
    const active = await db.query.SequenceRun.findFirst({
      where: and(
        eq(schema.SequenceRun.sequenceId, sequence.id),
        eq(schema.SequenceRun.subjectId, subjectId),
        eq(schema.SequenceRun.status, 'active')
      ),
      columns: { id: true },
    })
    if (active) return ok({ status: 'skipped', reason: 'Already actively enrolled' })
  } else {
    // any-run-ever (decision #13's sweep dedup, `SequenceRun_sequenceId_subjectId_idx`).
    const anyRun = await db.query.SequenceRun.findFirst({
      where: and(
        eq(schema.SequenceRun.sequenceId, sequence.id),
        eq(schema.SequenceRun.subjectId, subjectId)
      ),
      columns: { id: true },
    })
    if (anyRun) return ok({ status: 'skipped', reason: 'Already enrolled (any-run-ever)' })
  }

  const workflowApp = await db.query.WorkflowApp.findFirst({
    where: eq(schema.WorkflowApp.id, sequence.workflowAppId),
  })
  if (!workflowApp?.workflowId) {
    return ok({ status: 'skipped', reason: 'Sequence has no published workflow' })
  }

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

  // Recipient existence — subject -> work_order -> contact -> primary email (§4.3). The
  // actual send re-resolves at send time (decision #15); this is enroll-time validation only.
  const recipient = await resolveSubjectRecipientEmail(
    db,
    organizationId,
    systemUserId,
    subjectKind,
    subjectId
  )
  if (!recipient) {
    return ok({ status: 'skipped', reason: 'No linked contact / email address on file' })
  }

  if (sequence.respectSuppression) {
    const normalizedEmail = normalizeEmail(recipient.email)
    if (await isSuppressed(db, organizationId, normalizedEmail)) {
      return ok({ status: 'skipped', reason: 'Unsubscribed / suppressed' })
    }
  }

  // Enrollment filter (decision #17) — evaluated against the subject's root entity record.
  const filterGroups = (sequence.enrollmentFilter as ConditionGroup[] | null) ?? null
  if (filterGroups && filterGroups.length > 0) {
    const filterEntityKind = filterRootEntityKind(subjectKind)
    let filterEntityInstanceId: string | undefined
    if (subjectKind === 'work_order' || subjectKind === 'invoice') {
      filterEntityInstanceId = subjectId
    } else {
      const context = await resolveSubjectContext(
        db,
        organizationId,
        systemUserId,
        subjectKind,
        subjectId
      )
      filterEntityInstanceId = context.workOrderInstanceId
    }
    if (!filterEntityInstanceId) {
      return ok({
        status: 'skipped',
        reason: 'No work order to evaluate the enrollment filter against',
      })
    }
    const filterEntityDefId = await getCachedEntityDefId(organizationId, filterEntityKind)
    if (!filterEntityDefId) {
      return ok({ status: 'skipped', reason: 'Entity definition missing for enrollment filter' })
    }
    const matched = await evaluateEnrollmentFilter(
      organizationId,
      filterEntityDefId,
      filterEntityInstanceId,
      filterGroups
    )
    if (!matched) {
      return ok({ status: 'skipped', reason: 'Enrollment filter excluded this subject' })
    }
  }

  const steps = await db.query.SequenceStep.findMany({
    where: eq(schema.SequenceStep.sequenceId, sequence.id),
    orderBy: (t, { asc }) => asc(t.sortOrder),
  })
  if (steps.length === 0) {
    return ok({ status: 'skipped', reason: 'Sequence has no steps' })
  }

  // Recurring-born rule (decision #13) — `visit:scheduled` ONLY. A recurring-born visit
  // (materialized with startTime already set, never through `scheduleVisit`) gets anchored
  // reminders only; its relative/immediate steps don't count as "a step is still ahead" below.
  // Enforced again per-step at send time by `evaluateSubjectGuards` (belt + suspenders, same
  // pattern as the past-anchor rule).
  let recurrenceBorn = false
  if (subjectKind === 'visit' && sequence.triggerType === 'visit:scheduled') {
    const visit = await db.query.WorkOrderVisit.findFirst({
      where: and(
        eq(schema.WorkOrderVisit.id, subjectId),
        eq(schema.WorkOrderVisit.organizationId, organizationId)
      ),
      columns: { recurrenceRuleId: true },
    })
    recurrenceBorn = Boolean(visit?.recurrenceRuleId)
  }

  // Past-anchor rule (decision #10) — a step whose computed time is already behind `now` is
  // skipped; if EVERY step is past (or recurring-skipped), don't enroll at all.
  const timezone = sequence.deliveryTimezone ?? 'UTC'
  let anchorDate: Date | null = null
  if (steps.some((s) => s.timingMode === 'anchor')) {
    const resolved = await resolveSubjectAnchorDate(db, organizationId, subjectKind, subjectId)
    if (!resolved.exists) {
      return ok({ status: 'skipped', reason: 'Subject record no longer exists' })
    }
    anchorDate = resolved.anchorDate
  }

  const now = new Date()
  let hasFutureStep = false
  for (const step of steps) {
    if (recurrenceBorn && step.timingMode !== 'anchor') continue
    if (step.timingMode === 'anchor') {
      const target = computeAnchorTarget(
        anchorDate,
        { offsetDays: step.anchorOffsetDays, timeOfDay: step.anchorTimeOfDay },
        timezone
      )
      if (!isPastAnchor(target, now)) {
        hasFutureStep = true
        break
      }
    } else {
      hasFutureStep = true // relative steps have no absolute "past" concept at enroll time
      break
    }
  }
  if (!hasFutureStep) {
    return ok({ status: 'skipped', reason: 'All steps are past (or recurring-skipped)' })
  }

  // Enroll — mirror `enrollRecipients`' clean ordering: the `WorkflowRun` is created first, the
  // `SequenceRun` row inserted only on success (nothing to roll back on a start failure).
  const sequenceRunId = generateId()
  const contactEntityInstanceId = recipient.contactRecordId
    ? parseRecordId(recipient.contactRecordId).entityInstanceId
    : undefined

  const runResult = await startSystemWorkflowRun({
    workflowId: workflowApp.workflowId,
    inputs: {
      sequenceRunId,
      sequenceId: sequence.id,
      subjectKind,
      subjectId,
      recipientEntityInstanceId: contactEntityInstanceId,
      recipientEmail: recipient.email,
    },
    organizationId,
  })
  if (runResult.isErr()) {
    logger.error('Failed to start workflow run for subject enrollment', {
      sequenceId: sequence.id,
      subjectKind,
      subjectId,
      error: runResult.error.message,
    })
    return ok({ status: 'skipped', reason: 'Failed to start sequence run' })
  }

  try {
    await db.insert(schema.SequenceRun).values({
      id: sequenceRunId,
      organizationId,
      sequenceId: sequence.id,
      workflowRunId: runResult.value.id,
      recipientEntityInstanceId: contactEntityInstanceId ?? null,
      recipientEmail: recipient.email,
      subjectKind,
      subjectId,
      unsubscribeToken: generateId(),
      status: 'active',
      lastCompletedStep: 0,
    })
  } catch (error) {
    logger.error('SequenceRun insert failed after workflow run was created (subject enroll)', {
      sequenceId: sequence.id,
      subjectKind,
      subjectId,
      workflowRunId: runResult.value.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return ok({ status: 'skipped', reason: 'Enrollment failed' })
  }

  return ok({ status: 'enrolled', sequenceRunId })
}
