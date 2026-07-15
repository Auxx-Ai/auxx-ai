// packages/lib/src/sequences/hooks.ts
// Event-trigger hook BODIES (client-notifications plan §4.3/§4.10) — the composition point
// between `getEnabledSequencesForTrigger` + `enrollSubjectInSequence`/`exitActiveRunsForSequence`
// (or a targeted per-subject `exitSequenceRun` loop) that each visit-mutation / field-change
// hook call site invokes. Kept as its own module (not inlined in `visit-mutations.ts` /
// `register-hooks.ts`) so those call sites stay a one-line, try/catch'd call — mirrors the
// `dispatch/worker-notifications.ts` sibling-module convention. Every exported function here
// swallows its own errors (logged) — callers still wrap in try/catch as a second layer of
// defense, matching the existing `visit-mutations.ts` convention.

import type { SequenceTriggerType } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { AnchorSubjectKind } from './anchor'
import type { SequenceExitReason } from './client'
import { exitSequenceRun } from './runtime'
import { enrollSubjectInSequence } from './subject-enroll'
import { getEnabledSequencesForTrigger } from './triggers'

const logger = createScopedLogger('sequences-hooks')

/** Enroll a subject into every enabled sequence for a trigger — the shared loop every hook
 * below funnels through. Never throws (each failure is logged and the loop continues). */
async function enrollForTrigger(
  organizationId: string,
  triggerType: SequenceTriggerType,
  subjectKind: AnchorSubjectKind,
  subjectId: string,
  source: 'hook' | 'sweep' = 'hook'
): Promise<void> {
  const sequences = await getEnabledSequencesForTrigger(database, organizationId, triggerType)
  for (const sequence of sequences) {
    const result = await enrollSubjectInSequence(database, {
      organizationId,
      sequence,
      subjectKind,
      subjectId,
      source,
    })
    if (result.isErr()) {
      logger.error('Subject enrollment failed', {
        organizationId,
        sequenceId: sequence.id,
        triggerType,
        subjectKind,
        subjectId,
        error: result.error.message,
      })
    } else if (result.value.status === 'skipped') {
      logger.debug('Subject enrollment skipped', {
        organizationId,
        sequenceId: sequence.id,
        triggerType,
        subjectKind,
        subjectId,
        reason: result.value.reason,
      })
    }
  }
}

/** `visit:scheduled` — a one-off visit transitions null→set `startTime` (`scheduleVisit`).
 * Recurring-born visits are never enrolled here (never through `scheduleVisit` at all) — the
 * hourly sweep owns them (decision #13). */
export async function enrollVisitScheduledSequences(
  organizationId: string,
  visitId: string
): Promise<void> {
  await enrollForTrigger(organizationId, 'visit:scheduled', 'visit', visitId, 'hook')
}

/** `visit:en_route` (`setVisitStatus('en_route')`) — dedup: skip if the most recent run for
 * this (sequence, visit) is still active, OR exited less than 6h ago (a quick en_route →
 * on_site → en_route flap shouldn't re-send "we're on our way"). Using `SequenceRun.enrolledAt`
 * as the recency marker is the cheapest honest check available — it's the per-step sent-log
 * already (§4.1 decision #4), no extra `EntitySignal` join needed. */
export async function enrollVisitEnRouteSequences(
  organizationId: string,
  visitId: string
): Promise<void> {
  const sequences = await getEnabledSequencesForTrigger(database, organizationId, 'visit:en_route')
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)

  for (const sequence of sequences) {
    const mostRecent = await database.query.SequenceRun.findFirst({
      where: and(
        eq(schema.SequenceRun.sequenceId, sequence.id),
        eq(schema.SequenceRun.subjectId, visitId)
      ),
      columns: { id: true, status: true, enrolledAt: true },
      orderBy: (t, { desc }) => desc(t.enrolledAt),
    })
    if (mostRecent && (mostRecent.status === 'active' || mostRecent.enrolledAt >= sixHoursAgo)) {
      continue
    }

    const result = await enrollSubjectInSequence(database, {
      organizationId,
      sequence,
      subjectKind: 'visit',
      subjectId: visitId,
      source: 'hook',
    })
    if (result.isErr()) {
      logger.error('En-route enrollment failed', {
        organizationId,
        sequenceId: sequence.id,
        visitId,
        error: result.error.message,
      })
    }
  }
}

/** `visit:completed` (`setVisitStatus('done')`) — enrolls the opt-in `visit_follow_up`
 * sequence (subject=visit) AND eagerly exits any active `visit:scheduled`-triggered run for
 * this visit with `'completed_subject'` (the visit's reminders have nothing left to remind
 * about — `evaluateSubjectGuards` would also catch this lazily at the run's next send, this is
 * the eager companion). */
export async function onVisitCompleted(organizationId: string, visitId: string): Promise<void> {
  await enrollForTrigger(organizationId, 'visit:completed', 'visit', visitId, 'hook')

  const scheduledSequences = await getEnabledSequencesForTrigger(
    database,
    organizationId,
    'visit:scheduled'
  )
  for (const sequence of scheduledSequences) {
    const activeRuns = await database.query.SequenceRun.findMany({
      where: and(
        eq(schema.SequenceRun.sequenceId, sequence.id),
        eq(schema.SequenceRun.subjectId, visitId),
        eq(schema.SequenceRun.status, 'active')
      ),
      columns: { id: true },
    })
    for (const run of activeRuns) {
      const result = await exitSequenceRun(database, {
        sequenceRunId: run.id,
        organizationId,
        reason: 'completed_subject',
      })
      if (result.isErr()) {
        logger.error('Failed to exit visit:scheduled run on visit completion', {
          organizationId,
          sequenceId: sequence.id,
          visitId,
          runId: run.id,
          error: result.error.message,
        })
      }
    }
  }
}

/** Exit every active subject-scoped run for a single visit (any trigger) — canceled /
 * unscheduled / deleted (§4.2/§4.9). An en-route or follow-up run pointed at a visit that no
 * longer exists / is canceled has nothing left to do either, not just its reminders. */
export async function exitVisitSequenceRuns(
  organizationId: string,
  visitId: string,
  reason: SequenceExitReason
): Promise<void> {
  const runs = await database.query.SequenceRun.findMany({
    where: and(
      eq(schema.SequenceRun.organizationId, organizationId),
      eq(schema.SequenceRun.subjectKind, 'visit'),
      eq(schema.SequenceRun.subjectId, visitId),
      eq(schema.SequenceRun.status, 'active')
    ),
    columns: { id: true },
  })
  for (const run of runs) {
    const result = await exitSequenceRun(database, {
      sequenceRunId: run.id,
      organizationId,
      reason,
    })
    if (result.isErr()) {
      logger.error('Failed to exit visit sequence run', {
        organizationId,
        visitId,
        runId: run.id,
        reason,
        error: result.error.message,
      })
    }
  }
}

/** Bulk-exit active subject-scoped runs for a BATCH of now-deleted visit ids — the recurring
 * rule-edit / pause / end churn sites (§4.10). Same single-visit exit as
 * `exitVisitSequenceRuns`, batched. Cheap no-op when `visitIds` is empty. */
export async function exitRunsForDeadVisitSubjects(
  organizationId: string,
  visitIds: string[],
  reason: SequenceExitReason
): Promise<void> {
  if (visitIds.length === 0) return
  const runs = await database.query.SequenceRun.findMany({
    where: and(
      eq(schema.SequenceRun.organizationId, organizationId),
      eq(schema.SequenceRun.subjectKind, 'visit'),
      inArray(schema.SequenceRun.subjectId, visitIds),
      eq(schema.SequenceRun.status, 'active')
    ),
    columns: { id: true },
  })
  for (const run of runs) {
    const result = await exitSequenceRun(database, {
      sequenceRunId: run.id,
      organizationId,
      reason,
    })
    if (result.isErr()) {
      logger.error('Failed to exit sequence run for dead recurring visit subject', {
        organizationId,
        runId: run.id,
        reason,
        error: result.error.message,
      })
    }
  }
}

/** `work_order:completed` (the `work_order_status` field-change hook landing on `completed`
 * OR `ended`) — subject = work_order (the seeded `job_follow_up` sequence). */
export async function enrollWorkOrderCompletedSequences(
  organizationId: string,
  workOrderInstanceId: string
): Promise<void> {
  await enrollForTrigger(
    organizationId,
    'work_order:completed',
    'work_order',
    workOrderInstanceId,
    'hook'
  )
}

/** `invoice:sent` (the `invoice_status` field-change hook, draft→sent transition only) —
 * subject = invoice EntityInstance id (the seeded `invoice_reminders` sequence). */
export async function enrollInvoiceSentSequences(
  organizationId: string,
  invoiceInstanceId: string
): Promise<void> {
  await enrollForTrigger(organizationId, 'invoice:sent', 'invoice', invoiceInstanceId, 'hook')
}
