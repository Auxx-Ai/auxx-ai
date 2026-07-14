// packages/lib/src/sequences/stats.ts
// Header stats for the sequence detail page (Sequences plan §13/Phase 4 data
// source, built here so the tRPC router has it ready). Three grouped queries
// (status / exitReason / lastCompletedStep) instead of N per-step count
// queries — per-step "sent" counts are a cumulative sum over the
// `lastCompletedStep` histogram computed in application code.

import { type Database, schema } from '@auxx/database'
import { and, count, eq, isNotNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import type { SequenceStats } from './types'

export interface GetSequenceStatsInput {
  sequenceId: string
  organizationId: string
}

export async function getSequenceStats(
  db: Database,
  input: GetSequenceStatsInput
): Promise<Result<SequenceStats, Error>> {
  const { sequenceId, organizationId } = input

  const sequence = await db.query.Sequence.findFirst({
    where: and(
      eq(schema.Sequence.id, sequenceId),
      eq(schema.Sequence.organizationId, organizationId)
    ),
    columns: { id: true },
  })
  if (!sequence) return err(new NotFoundError('Sequence not found'))

  const [stepCountRow, statusRows, reasonRows, stepHistogramRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.SequenceStep)
      .where(
        and(
          eq(schema.SequenceStep.sequenceId, sequenceId),
          eq(schema.SequenceStep.organizationId, organizationId)
        )
      ),
    db
      .select({ status: schema.SequenceRun.status, total: count() })
      .from(schema.SequenceRun)
      .where(
        and(
          eq(schema.SequenceRun.sequenceId, sequenceId),
          eq(schema.SequenceRun.organizationId, organizationId)
        )
      )
      .groupBy(schema.SequenceRun.status),
    db
      .select({ exitReason: schema.SequenceRun.exitReason, total: count() })
      .from(schema.SequenceRun)
      .where(
        and(
          eq(schema.SequenceRun.sequenceId, sequenceId),
          eq(schema.SequenceRun.organizationId, organizationId),
          isNotNull(schema.SequenceRun.exitReason)
        )
      )
      .groupBy(schema.SequenceRun.exitReason),
    db
      .select({ lastCompletedStep: schema.SequenceRun.lastCompletedStep, total: count() })
      .from(schema.SequenceRun)
      .where(
        and(
          eq(schema.SequenceRun.sequenceId, sequenceId),
          eq(schema.SequenceRun.organizationId, organizationId)
        )
      )
      .groupBy(schema.SequenceRun.lastCompletedStep),
  ])

  const stepCount = stepCountRow[0]?.total ?? 0

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.total]))
  const enrolled = statusRows.reduce((sum, r) => sum + r.total, 0)
  const active = byStatus.active ?? 0
  const completed = byStatus.completed ?? 0
  const exited = byStatus.exited ?? 0
  const failed = byStatus.failed ?? 0

  const byReason = Object.fromEntries(reasonRows.map((r) => [r.exitReason, r.total]))
  const replyRate = enrolled > 0 ? (byReason.reply ?? 0) / enrolled : 0
  const bounceRate = enrolled > 0 ? (byReason.bounce ?? 0) / enrolled : 0

  // Cumulative: perStepSent[n] = count of runs with lastCompletedStep >= n.
  const perStepSent: Record<number, number> = {}
  for (let n = 1; n <= stepCount; n++) {
    perStepSent[n] = stepHistogramRows
      .filter((r) => r.lastCompletedStep >= n)
      .reduce((sum, r) => sum + r.total, 0)
  }

  return ok({ enrolled, active, completed, exited, failed, perStepSent, replyRate, bounceRate })
}
