// packages/lib/src/jobs/ai-autofill/ai-autofill-job.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getExistingFieldValue } from '@auxx/services/field-values'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import type { GenerationResult } from '../../field-values/ai-autofill/generation-service'
import { generateFieldValue } from '../../field-values/ai-autofill/generation-service'
import { writeAiError } from '../../field-values/ai-commit'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithBuiltIn } from '../../field-values/field-value-mutations'
import type { JobContext } from '../types/job-context'

const logger = createScopedLogger('job:ai-autofill')

export interface AiAutofillJobData {
  orgId: string
  userId?: string
  recordId: RecordId
  fieldId: string
  /** Our own correlation id, echoed back to the commit path for override check */
  jobId: string
  requestedAt: string
}

/**
 * BullMQ handler for per-field AI autofill. Thin wrapper:
 *
 *   1. Override check — drop if the row's current `aiStatus/jobId` no longer
 *      matches this job (user manually edited, or re-triggered)
 *   2. Generate — pure compute; `AbortSignal` forwarded when available
 *   3. Commit — via `setValueWithBuiltIn(..., { aiGeneration })` (normal set
 *      pipeline, so CALC chains / uniqueness / display-name updates run)
 *   4. On failure at any step — route through `writeAiError`
 */
export async function aiAutofillJob(ctx: JobContext<AiAutofillJobData>) {
  const { orgId, userId, recordId, fieldId, jobId } = ctx.data

  const fvCtx = createFieldValueContext(orgId, userId, database)
  const { entityInstanceId } = parseRecordId(recordId)

  // 1. Override check
  const existing = await getExistingFieldValue({
    entityId: entityInstanceId,
    fieldId,
    organizationId: orgId,
  })
  if (existing.isErr() || !existing.value) {
    logger.info('Dropping AI autofill — no row to update', { jobId, recordId, fieldId })
    return { dropped: 'no-row' as const }
  }

  const currentMeta = (existing.value.valueJson ?? {}) as { jobId?: string }
  if (existing.value.aiStatus !== 'generating' || currentMeta.jobId !== jobId) {
    logger.info('Dropping AI autofill — override detected', {
      jobId,
      actualJobId: currentMeta.jobId,
      aiStatus: existing.value.aiStatus,
      recordId,
      fieldId,
    })
    return { dropped: 'override' as const }
  }

  // 2. Generate
  let result: GenerationResult
  try {
    result = await generateFieldValue({
      orgId,
      userId,
      recordId,
      fieldId,
      signal: ctx.signal,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.warn('AI autofill generation failed', { jobId, recordId, fieldId, errorMessage })
    await writeAiError(fvCtx, { recordId, fieldId, errorMessage })
    return { error: errorMessage }
  }

  // 3. Commit via normal set pipeline — CALC cascades / uniqueness / realtime
  //    happen for free inside setValueWithBuiltIn.
  try {
    await setValueWithBuiltIn(fvCtx, {
      recordId,
      fieldId,
      value: result.value,
      aiGeneration: result.meta,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.warn('AI autofill commit failed', { jobId, recordId, fieldId, errorMessage })
    await writeAiError(fvCtx, { recordId, fieldId, errorMessage })
    return { error: errorMessage }
  }

  return { committed: true }
}
