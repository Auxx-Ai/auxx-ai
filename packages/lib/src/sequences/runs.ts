// packages/lib/src/sequences/runs.ts
// Recipients-tab read model + manual exit (Sequences plan §3.3/Phase 2).

import { type Database, schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { exitSequenceRun } from './runtime'
import type { SequenceRunListItem } from './types'

export interface ListRunsInput {
  sequenceId: string
  organizationId: string
  status?: 'active' | 'completed' | 'exited' | 'failed'
}

/**
 * List a sequence's runs (newest-enrolled first), joined against
 * `EntityInstance.displayName` for the recipient's name — no per-record
 * field-value lookups (the denormalized column is the established bulk-list
 * pattern, see `ai/kopilot/capabilities/entities/tools/search-entities.ts`).
 */
export async function listRuns(
  db: Database,
  input: ListRunsInput
): Promise<Result<SequenceRunListItem[], Error>> {
  const { sequenceId, organizationId, status } = input

  const rows = await db
    .select({
      run: schema.SequenceRun,
      recipientDisplayName: schema.EntityInstance.displayName,
    })
    .from(schema.SequenceRun)
    .leftJoin(
      schema.EntityInstance,
      eq(schema.SequenceRun.recipientEntityInstanceId, schema.EntityInstance.id)
    )
    .where(
      and(
        eq(schema.SequenceRun.sequenceId, sequenceId),
        eq(schema.SequenceRun.organizationId, organizationId),
        status ? eq(schema.SequenceRun.status, status) : undefined
      )
    )
    .orderBy(desc(schema.SequenceRun.enrolledAt))

  const items: SequenceRunListItem[] = rows.map(({ run, recipientDisplayName }) => ({
    id: run.id,
    organizationId: run.organizationId,
    sequenceId: run.sequenceId,
    workflowRunId: run.workflowRunId,
    recipientEntityInstanceId: run.recipientEntityInstanceId,
    recipientDisplayName: recipientDisplayName ?? null,
    recipientEmail: run.recipientEmail,
    threadId: run.threadId,
    status: run.status,
    exitReason: run.exitReason,
    exitMetadata: run.exitMetadata ?? null,
    lastCompletedStep: run.lastCompletedStep,
    lastSentAt: run.lastSentAt,
    enrolledById: run.enrolledById,
    enrolledAt: run.enrolledAt,
    exitedAt: run.exitedAt,
  }))

  return ok(items)
}

export interface ManualExitRunInput {
  sequenceRunId: string
  organizationId: string
}

/** Manually remove a recipient from a sequence — thin wrap over `exitSequenceRun`. */
export async function manualExitRun(
  db: Database,
  input: ManualExitRunInput
): Promise<Result<void, Error>> {
  const run = await db.query.SequenceRun.findFirst({
    where: and(
      eq(schema.SequenceRun.id, input.sequenceRunId),
      eq(schema.SequenceRun.organizationId, input.organizationId)
    ),
    columns: { id: true },
  })
  if (!run) return err(new NotFoundError('Sequence run not found'))

  return exitSequenceRun(db, {
    sequenceRunId: input.sequenceRunId,
    organizationId: input.organizationId,
    reason: 'manual',
  })
}
