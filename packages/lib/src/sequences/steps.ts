// packages/lib/src/sequences/steps.ts
// SequenceStep CRUD + fractional reorder (Sequences plan §3.4/Phase 2). Follows
// the codebase's real fractional-indexing convention (`kb/articles/move-article.ts`,
// `kb/internal/placement.ts`) — `generateKeyBetween(prevKey, nextKey)` computes the
// midpoint, `null` on either side means "no neighbor" (start/end of list). Any
// step edit marks the parent `Sequence.hasUnpublishedChanges: true` once published.

import { type Database, schema } from '@auxx/database'
import { generateKeyBetween } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import type {
  CreateStepInput,
  ReorderStepInput,
  SequenceStepEntity,
  UpdateStepFields,
} from './types'

/** Mark the parent sequence dirty after a step edit, but only if it's been published. */
async function markDirtyIfPublished(db: Database, sequenceId: string): Promise<void> {
  const sequence = await db.query.Sequence.findFirst({
    where: eq(schema.Sequence.id, sequenceId),
    columns: { publishedAt: true },
  })
  if (sequence?.publishedAt) {
    await db
      .update(schema.Sequence)
      .set({ hasUnpublishedChanges: true })
      .where(eq(schema.Sequence.id, sequenceId))
  }
}

/** Append a new step to the end of the sequence's step list. */
export async function createStep(
  db: Database,
  input: CreateStepInput
): Promise<Result<SequenceStepEntity, Error>> {
  const { sequenceId, organizationId, ...fields } = input

  const lastStep = await db.query.SequenceStep.findFirst({
    where: eq(schema.SequenceStep.sequenceId, sequenceId),
    orderBy: (t, { desc }) => desc(t.sortOrder),
    columns: { sortOrder: true },
  })
  const sortOrder = generateKeyBetween(lastStep?.sortOrder ?? null, null)

  const [created] = await db
    .insert(schema.SequenceStep)
    .values({
      organizationId,
      sequenceId,
      sortOrder,
      delayDays: fields.delayDays ?? 0,
      delayHours: fields.delayHours ?? 0,
      subject: fields.subject ?? null,
      bodyJson: fields.bodyJson ?? null,
      bodyHtml: fields.bodyHtml ?? null,
      attachmentIds: fields.attachmentIds ?? [],
      timingMode: fields.timingMode ?? 'relative',
      anchorOffsetDays: fields.anchorOffsetDays ?? 0,
      anchorTimeOfDay: fields.anchorTimeOfDay ?? null,
      channel: fields.channel ?? 'email',
    })
    .returning()

  await markDirtyIfPublished(db, sequenceId)

  return ok(created!)
}

export interface UpdateStepInput {
  stepId: string
  organizationId: string
  fields: UpdateStepFields
}

/** Patch a step's content/delay. */
export async function updateStep(
  db: Database,
  input: UpdateStepInput
): Promise<Result<SequenceStepEntity, Error>> {
  const { stepId, organizationId, fields } = input
  const existing = await db.query.SequenceStep.findFirst({
    where: and(
      eq(schema.SequenceStep.id, stepId),
      eq(schema.SequenceStep.organizationId, organizationId)
    ),
  })
  if (!existing) return err(new NotFoundError('Sequence step not found'))

  const [updated] = await db
    .update(schema.SequenceStep)
    .set(fields)
    .where(eq(schema.SequenceStep.id, stepId))
    .returning()

  await markDirtyIfPublished(db, existing.sequenceId)

  return ok(updated!)
}

/** Delete a step. */
export async function deleteStep(
  db: Database,
  params: { stepId: string; organizationId: string }
): Promise<Result<void, Error>> {
  const existing = await db.query.SequenceStep.findFirst({
    where: and(
      eq(schema.SequenceStep.id, params.stepId),
      eq(schema.SequenceStep.organizationId, params.organizationId)
    ),
    columns: { sequenceId: true },
  })
  if (!existing) return err(new NotFoundError('Sequence step not found'))

  await db.delete(schema.SequenceStep).where(eq(schema.SequenceStep.id, params.stepId))

  await markDirtyIfPublished(db, existing.sequenceId)

  return ok(undefined)
}

/**
 * Move a step to sit between `previousStepId` and `nextStepId` (either may be
 * omitted/null for "start of list" / "end of list").
 */
export async function reorderStep(
  db: Database,
  input: ReorderStepInput
): Promise<Result<SequenceStepEntity, Error>> {
  const { stepId, organizationId, sequenceId, previousStepId, nextStepId } = input

  const existing = await db.query.SequenceStep.findFirst({
    where: and(
      eq(schema.SequenceStep.id, stepId),
      eq(schema.SequenceStep.organizationId, organizationId)
    ),
  })
  if (!existing) return err(new NotFoundError('Sequence step not found'))

  const [previousStep, nextStep] = await Promise.all([
    previousStepId
      ? db.query.SequenceStep.findFirst({
          where: eq(schema.SequenceStep.id, previousStepId),
          columns: { sortOrder: true },
        })
      : Promise.resolve(null),
    nextStepId
      ? db.query.SequenceStep.findFirst({
          where: eq(schema.SequenceStep.id, nextStepId),
          columns: { sortOrder: true },
        })
      : Promise.resolve(null),
  ])

  const sortOrder = generateKeyBetween(previousStep?.sortOrder ?? null, nextStep?.sortOrder ?? null)

  const [updated] = await db
    .update(schema.SequenceStep)
    .set({ sortOrder })
    .where(eq(schema.SequenceStep.id, stepId))
    .returning()

  await markDirtyIfPublished(db, sequenceId)

  return ok(updated!)
}
