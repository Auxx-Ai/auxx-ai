// packages/lib/src/sequences/sweep.ts
// Hourly enrollment sweep (client-notifications plan §4.3, decision #13 — sweep-as-primary for
// recurring visits). Per enabled `visit:scheduled` sequence, enrolls every `WorkOrderVisit`
// with `status='scheduled'`, non-null `startTime`, within the sequence's own computed
// lookahead window — any-run-ever dedup happens inside `enrollSubjectInSequence`'s
// `source:'sweep'` branch. Covers one-off AND recurring visits; self-heals missed hooks and
// rule-edit churn by construction (a re-inserted visit is a fresh id entering the window, with
// past steps skipped per decision #10).

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, gte, isNotNull, lte } from 'drizzle-orm'
import { enrollSubjectInSequence } from './subject-enroll'

const logger = createScopedLogger('sequences-sweep')

/** `N = abs(min(anchorOffsetDays over steps)) + 2` days, floor 3 — survives an org editing the
 * template to e.g. -10d (a wider window always still catches the visits that need it). No
 * anchor steps (or no steps at all) ⇒ the floor. */
export function computeSweepLookaheadDays(anchorOffsetDaysByStep: number[]): number {
  if (anchorOffsetDaysByStep.length === 0) return 3
  const mostNegative = Math.min(...anchorOffsetDaysByStep, 0)
  return Math.max(3, Math.abs(mostNegative) + 2)
}

type SequenceRow = typeof schema.Sequence.$inferSelect

async function sweepSequence(sequence: SequenceRow): Promise<void> {
  if (!sequence.publishedAt) return

  const steps = await database.query.SequenceStep.findMany({
    where: eq(schema.SequenceStep.sequenceId, sequence.id),
    columns: { timingMode: true, anchorOffsetDays: true },
  })
  const anchorOffsets = steps
    .filter((s) => s.timingMode === 'anchor')
    .map((s) => s.anchorOffsetDays)
  const lookaheadDays = computeSweepLookaheadDays(anchorOffsets)

  const now = new Date()
  const windowEnd = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000)

  const visits = await database.query.WorkOrderVisit.findMany({
    where: and(
      eq(schema.WorkOrderVisit.organizationId, sequence.organizationId),
      eq(schema.WorkOrderVisit.status, 'scheduled'),
      isNotNull(schema.WorkOrderVisit.startTime),
      gte(schema.WorkOrderVisit.startTime, now),
      lte(schema.WorkOrderVisit.startTime, windowEnd)
    ),
    columns: { id: true },
  })

  for (const visit of visits) {
    const result = await enrollSubjectInSequence(database, {
      organizationId: sequence.organizationId,
      sequence,
      subjectKind: 'visit',
      subjectId: visit.id,
      source: 'sweep',
    })
    if (result.isErr()) {
      logger.error('Sweep enrollment failed for visit', {
        sequenceId: sequence.id,
        organizationId: sequence.organizationId,
        visitId: visit.id,
        error: result.error.message,
      })
    }
  }
}

/** Run the sweep once — called hourly by `sequenceEnrollmentSweepJob`. Every enabled
 * `visit:scheduled` sequence across every org gets its own lookahead window (different
 * sequences may have edited their steps to different offsets); one sequence's failure never
 * blocks the rest. */
export async function runSequenceEnrollmentSweep(): Promise<void> {
  const sequences = await database.query.Sequence.findMany({
    where: and(
      eq(schema.Sequence.triggerType, 'visit:scheduled'),
      eq(schema.Sequence.status, 'enabled')
    ),
  })
  if (sequences.length === 0) return

  for (const sequence of sequences) {
    try {
      await sweepSequence(sequence)
    } catch (error) {
      logger.error('Enrollment sweep failed for sequence', {
        sequenceId: sequence.id,
        organizationId: sequence.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
