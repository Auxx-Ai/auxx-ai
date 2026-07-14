// packages/lib/src/sequences/enroll.ts
// Enroll recipients into a published sequence (Sequences plan §3.3/Phase 2,
// cap 50 per plan §15). `SequenceRun.workflowRunId` is NOT NULL, so the
// `WorkflowRun` is created FIRST (via `startSystemWorkflowRun`) and the
// `SequenceRun` row inserted only on success — this is the "clean" ordering
// the plan calls for: on a `startSystemWorkflowRun` failure there is nothing
// to roll back, since no `SequenceRun` row was ever created. The run id is
// pre-generated so it can be threaded through as `sys.triggerData.sequenceRunId`
// (the `sequence-send-email` node's lookup key) before the row exists.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud'
import { startSystemWorkflowRun } from '../workflows/system-workflow-run'
import { SEQUENCE_ENROLL_MAX_RECIPIENTS } from './client'
import { isSuppressed, normalizeEmail } from './suppression'
import type { EnrollRecipientResult, EnrollRecipientsInput } from './types'

const logger = createScopedLogger('sequences-enroll')

/** Unwrap a `getFieldValues()` map entry — takes the first value if array-returned. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Enroll up to 50 recipients (contacts) into a published, enabled sequence.
 * Guards, in order, per recipient: has an email · not org-suppressed · no
 * existing active run for this sequence. Returns a per-recipient outcome —
 * never throws for an individual recipient failure.
 */
export async function enrollRecipients(
  db: Database,
  input: EnrollRecipientsInput
): Promise<Result<EnrollRecipientResult[], Error>> {
  const { sequenceId, organizationId, recipientEntityInstanceIds, enrolledById } = input

  if (recipientEntityInstanceIds.length > SEQUENCE_ENROLL_MAX_RECIPIENTS) {
    return err(
      new BadRequestError(
        `Cannot enroll more than ${SEQUENCE_ENROLL_MAX_RECIPIENTS} recipients at once`
      )
    )
  }
  if (recipientEntityInstanceIds.length === 0) return ok([])

  const sequence = await db.query.Sequence.findFirst({
    where: and(
      eq(schema.Sequence.id, sequenceId),
      eq(schema.Sequence.organizationId, organizationId)
    ),
  })
  if (!sequence) return err(new NotFoundError('Sequence not found'))
  if (sequence.status !== 'enabled' || !sequence.publishedAt) {
    return err(new BadRequestError('Sequence must be published and enabled to enroll recipients'))
  }

  const workflowApp = await db.query.WorkflowApp.findFirst({
    where: eq(schema.WorkflowApp.id, sequence.workflowAppId),
  })
  if (!workflowApp?.workflowId) {
    return err(new BadRequestError('Sequence has no published workflow'))
  }
  const workflowId = workflowApp.workflowId

  const cache = getOrgCache()
  const cf = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes(['primary_email'] as const)
  const emailFieldId = cf.primary_email?.id
  const handler = new UnifiedCrudHandler(organizationId, enrolledById)

  const results: EnrollRecipientResult[] = []

  for (const recipientId of recipientEntityInstanceIds) {
    let email: string | undefined
    if (emailFieldId) {
      const values = await handler.getFieldValues(toRecordId('contact', recipientId), [
        emailFieldId,
      ])
      const typed = firstTyped(values.get(emailFieldId))
      email = typed ? (extractValue(typed) as string) : undefined
    }
    if (!email) {
      results.push({ recipientId, status: 'skipped', reason: 'No email address on file' })
      continue
    }

    const normalizedEmail = normalizeEmail(email)
    if (await isSuppressed(db, organizationId, normalizedEmail)) {
      results.push({ recipientId, status: 'skipped', reason: 'Unsubscribed / suppressed' })
      continue
    }

    const existingActive = await db.query.SequenceRun.findFirst({
      where: and(
        eq(schema.SequenceRun.sequenceId, sequenceId),
        eq(schema.SequenceRun.recipientEntityInstanceId, recipientId),
        eq(schema.SequenceRun.status, 'active')
      ),
      columns: { id: true },
    })
    if (existingActive) {
      results.push({ recipientId, status: 'skipped', reason: 'Already actively enrolled' })
      continue
    }

    const sequenceRunId = generateId()
    const runResult = await startSystemWorkflowRun({
      workflowId,
      inputs: {
        sequenceRunId,
        sequenceId,
        recipientEntityInstanceId: recipientId,
        recipientEmail: email,
      },
      organizationId,
    })
    if (runResult.isErr()) {
      logger.error('Failed to start workflow run for enrollment', {
        sequenceId,
        recipientId,
        error: runResult.error.message,
      })
      results.push({ recipientId, status: 'skipped', reason: 'Failed to start sequence run' })
      continue
    }

    try {
      await db.insert(schema.SequenceRun).values({
        id: sequenceRunId,
        organizationId,
        sequenceId,
        workflowRunId: runResult.value.id,
        recipientEntityInstanceId: recipientId,
        recipientEmail: email,
        unsubscribeToken: generateId(),
        status: 'active',
        lastCompletedStep: 0,
        enrolledById,
      })
      results.push({ recipientId, status: 'enrolled' })
    } catch (error) {
      // The WorkflowRun now exists without a SequenceRun row (e.g. lost the
      // active-run unique-index race, or a transient insert failure). Rare
      // edge case for v1 (no production users) — logged for visibility.
      logger.error('SequenceRun insert failed after workflow run was created', {
        sequenceId,
        recipientId,
        workflowRunId: runResult.value.id,
        error: error instanceof Error ? error.message : String(error),
      })
      results.push({ recipientId, status: 'skipped', reason: 'Enrollment failed' })
    }
  }

  return ok(results)
}
