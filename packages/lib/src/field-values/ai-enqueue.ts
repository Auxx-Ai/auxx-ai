// packages/lib/src/field-values/ai-enqueue.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getExistingFieldValue } from '@auxx/services/field-values'
import type { FieldId } from '@auxx/types/field'
import { buildFieldValueKey } from '@auxx/types/field'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils/generateId'
import { isAiField } from '../custom-fields/ai'
import { BadRequestError } from '../errors'
import { getQueue, Queues } from '../jobs/queues'
import { getRealtimeService } from '../realtime'
import { publishFieldValueUpdates } from '../realtime/publish-helpers'
import { createUsageGuard } from '../usage/create-usage-guard'
import { upsertGeneratingMarker } from './ai-commit'
import type { FieldValueContext } from './field-value-helpers'
import { getField } from './field-value-helpers'
import type { SetValueResult } from './types'

const logger = createScopedLogger('ai-enqueue')

/**
 * A row with `aiStatus='generating'` that's older than this is treated as
 * dead (worker crashed, BullMQ job lost) — `shortCircuitAiGenerate` will
 * enqueue a fresh job instead of returning the stale jobId.
 */
const STALE_GENERATING_MS = 5 * 60 * 1000

/**
 * Stage 1 of the AI autofill write pipeline. Called from the top of
 * `setValueWithBuiltIn` when `params.ai === true`.
 *
 *   1. Validates the field is AI-enabled
 *   2. Dedupes against an in-flight generation (within the staleness window)
 *   3. Consumes AI completion quota
 *   4. Upserts the row with `aiStatus='generating'` + `valueJson={jobId, requestedAt}`
 *   5. Enqueues a BullMQ job on `Queues.aiAutofillQueue`
 *   6. Publishes a `generating` realtime so peers shimmer immediately
 *
 * Returns a `SetValueResult` with `state='generating'` and the `jobId`.
 */
export async function shortCircuitAiGenerate(
  ctx: FieldValueContext,
  params: { recordId: RecordId; fieldId: string }
): Promise<SetValueResult> {
  const { recordId, fieldId } = params
  const { entityInstanceId } = parseRecordId(recordId)

  // 1. Eligibility check
  const field = await getField(ctx, fieldId)
  if (!isAiField(field)) {
    throw new BadRequestError('AI is not enabled on this field')
  }

  // 2. Load existing row + dedupe
  const existing = await getExistingFieldValue({
    entityId: entityInstanceId,
    fieldId,
    organizationId: ctx.organizationId,
  })

  if (existing.isOk() && existing.value?.aiStatus === 'generating') {
    const meta = (existing.value.valueJson ?? {}) as { jobId?: string; requestedAt?: string }
    const requestedAtMs = meta.requestedAt ? Date.parse(meta.requestedAt) : 0
    const isStale = !requestedAtMs || Date.now() - requestedAtMs > STALE_GENERATING_MS
    if (!isStale && meta.jobId) {
      logger.info('Deduping AI autofill — in-flight generation exists', {
        recordId,
        fieldId,
        jobId: meta.jobId,
      })
      return {
        state: 'generating',
        performedAt: meta.requestedAt ?? new Date().toISOString(),
        values: [],
        jobId: meta.jobId,
      }
    }
  }

  // 3. Quota guard — AI completions metric
  const guard = await createUsageGuard(database)
  if (guard) {
    const result = await guard.consume(ctx.organizationId, 'aiCompletions', {
      userId: ctx.userId,
    })
    if (!result.allowed) {
      throw new BadRequestError(
        result.reason === 'featureNotAvailable'
          ? 'AI autofill is not available on your plan'
          : 'AI completion quota exhausted for this billing period'
      )
    }
  }

  // 4. Upsert generating marker
  const jobId = generateId('ai-autofill')
  const requestedAt = new Date().toISOString()

  await upsertGeneratingMarker(ctx, { recordId, fieldId, jobId, requestedAt })

  // 5. Enqueue BullMQ job. `attempts: 1` overrides the default retry policy
  //    (T10) — failed generations become `aiStatus='error'` rather than
  //    retry noise. 60s soft timeout is enforced inside the handler.
  const queue = getQueue(Queues.aiAutofillQueue)
  await queue.add(
    'aiAutofillJob',
    {
      orgId: ctx.organizationId,
      userId: ctx.userId,
      recordId,
      fieldId,
      jobId,
      requestedAt,
    },
    { jobId, attempts: 1 }
  )

  // 6. Realtime generating — no value change
  const key = buildFieldValueKey(recordId, fieldId as FieldId)
  await publishFieldValueUpdates(
    getRealtimeService(),
    ctx.organizationId,
    [{ key, aiStatus: 'generating', aiMetadata: { jobId, requestedAt } }],
    ctx.socketId ? { excludeSocketId: ctx.socketId } : undefined
  ).catch(() => {
    // Realtime is best-effort; persistence already happened.
  })

  return {
    state: 'generating',
    performedAt: requestedAt,
    values: [],
    jobId,
  }
}
