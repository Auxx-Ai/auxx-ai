// packages/lib/src/field-values/ai-commit.ts

import {
  getExistingFieldValue,
  insertFieldValue,
  updateAiMarker,
} from '@auxx/services/field-values'
import type { FieldId } from '@auxx/types/field'
import { buildFieldValueKey } from '@auxx/types/field'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { getRealtimeService } from '../realtime'
import { publishFieldValueUpdates } from '../realtime/publish-helpers'
import type { AiValueMetadata } from './ai-autofill/generation-service'
import type { FieldValueContext } from './field-value-helpers'

/** Persistent AI generation state. `null` = not AI-generated (implicit clear). */
export type AiWriteState = 'generating' | 'result' | 'error'

/**
 * Merge an AI marker onto a partial insert/update row builder. Used inside
 * `buildFieldValueRow` when `SetValueWithTypeInput.aiGeneration` is present.
 */
export function applyAiMarker<T extends Record<string, unknown>>(
  row: T,
  meta: AiValueMetadata,
  state: AiWriteState = 'result'
): T & { aiStatus: AiWriteState; valueJson: unknown } {
  return { ...row, aiStatus: state, valueJson: meta as unknown }
}

/**
 * Read the AI metadata bag off a FieldValue row (shape parity with
 * `ExistingFieldValueRow`). Returns null when the row is not AI-generated.
 */
export function readAiMetadata(row: {
  aiStatus?: string | null
  valueJson?: unknown
}): AiValueMetadata | null {
  if (!row.aiStatus) return null
  return (row.valueJson ?? null) as AiValueMetadata | null
}

/**
 * Partial-update the AI marker on an existing row to `aiStatus='error'` +
 * merge the error metadata into `valueJson`. Preserves typed value columns
 * so the last-good value stays visible under the error overlay.
 *
 * `valueJson` is merged (not replaced) — forward-compatible with v2 types
 * that use `valueJson` for their own value alongside AI metadata.
 */
export async function writeAiError(
  ctx: FieldValueContext,
  params: { recordId: RecordId; fieldId: string; errorMessage: string }
): Promise<void> {
  const { entityInstanceId } = parseRecordId(params.recordId)

  const existing = await getExistingFieldValue({
    entityId: entityInstanceId,
    fieldId: params.fieldId,
    organizationId: ctx.organizationId,
  })
  if (existing.isErr() || !existing.value) return

  const failedAt = new Date().toISOString()
  const prev = (existing.value.valueJson ?? {}) as Record<string, unknown>

  // Drop metadata that belonged to the prior successful generation, keep
  // any unrelated keys future v2 types may add to valueJson.
  const {
    model: _model,
    generatedAt: _generatedAt,
    inputHash: _inputHash,
    tokens: _tokens,
    jobId: _jobId,
    requestedAt: _requestedAt,
    ...rest
  } = prev

  const nextValueJson = { ...rest, errorMessage: params.errorMessage, failedAt }

  await updateAiMarker({
    id: existing.value.id,
    organizationId: ctx.organizationId,
    aiStatus: 'error',
    valueJson: nextValueJson,
  })

  const key = buildFieldValueKey(params.recordId, params.fieldId as FieldId)
  await publishFieldValueUpdates(
    getRealtimeService(),
    ctx.organizationId,
    [{ key, aiStatus: 'error', aiMetadata: { errorMessage: params.errorMessage, failedAt } }],
    ctx.socketId ? { excludeSocketId: ctx.socketId } : undefined
  ).catch(() => {
    // Realtime is best-effort — persistence already happened.
  })
}

/**
 * Stage-1 marker upsert. Called from `shortCircuitAiGenerate`:
 *   - Row exists → partial update (preserves typed value columns)
 *   - Row absent → insert with `aiStatus='generating'` + metadata, typed value columns null
 *
 * Multi-value fields (MULTI_SELECT) with existing rows get the marker on
 * one representative row; the worker then replaces the full row set via
 * the normal DELETE+INSERT when it commits.
 */
export async function upsertGeneratingMarker(
  ctx: FieldValueContext,
  params: {
    recordId: RecordId
    fieldId: string
    jobId: string
    requestedAt: string
  }
): Promise<void> {
  const { entityInstanceId } = parseRecordId(params.recordId)

  const existing = await getExistingFieldValue({
    entityId: entityInstanceId,
    fieldId: params.fieldId,
    organizationId: ctx.organizationId,
  })

  const valueJson: AiValueMetadata = {
    jobId: params.jobId,
    requestedAt: params.requestedAt,
  }

  if (existing.isOk() && existing.value) {
    await updateAiMarker({
      id: existing.value.id,
      organizationId: ctx.organizationId,
      aiStatus: 'generating',
      valueJson,
    })
    return
  }

  await insertFieldValue({
    recordId: params.recordId,
    fieldId: params.fieldId,
    organizationId: ctx.organizationId,
    sortKey: generateKeyBetween(null, null),
    aiStatus: 'generating',
    valueJson,
  })
}
