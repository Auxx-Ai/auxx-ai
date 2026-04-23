// packages/lib/src/field-values/ai-autofill/generation-service.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import { SystemModelService } from '../../ai/providers/system-model-service'
import { ModelType } from '../../ai/providers/types'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { isAiField } from '../../custom-fields/ai'
import { extractFieldIdsFromString, formulaToString } from '../../custom-fields/formula-converters'
import { BadRequestError } from '../../errors'
import { createFieldValueContext, getField } from '../field-value-helpers'
import { computeInputHash } from './input-hash'
import { buildJsonSchema } from './json-schema-builder'
import { buildPrompt } from './prompt-builder'
import { resolveReferences } from './reference-resolver'

const logger = createScopedLogger('ai-autofill:generation-service')

/** AI metadata bag persisted to `FieldValue.valueJson` alongside `aiStatus`. */
export interface AiValueMetadata {
  model?: string
  generatedAt?: string
  inputHash?: string
  tokens?: { prompt: number; completion: number }
  jobId?: string
  errorMessage?: string
  failedAt?: string
  requestedAt?: string
}

export interface GenerationResult {
  /** LLM output, typed to match the field's native type. */
  value: unknown
  /** Metadata for the `valueJson` bag on a successful commit. */
  meta: AiValueMetadata
}

/**
 * Pure-compute AI generation for a (recordId, fieldId) pair. Resolves the
 * field's prompt against the record, invokes the LLM with a `json_schema`
 * structured-output envelope, and returns the parsed value + metadata.
 *
 * No writes to `FieldValue` — persistence is the caller's responsibility
 * (phase 03 worker commits via `setValueWithBuiltIn(..., { aiGeneration })`).
 *
 * Throws on: field not AI-enabled, no default LLM configured, quota
 * exhausted, LLM/provider failure, malformed structured output.
 */
export async function generateFieldValue(params: {
  orgId: string
  userId?: string
  recordId: RecordId
  fieldId: string
  /**
   * Reserved for future cancellation support. Not yet wired through
   * `LLMOrchestrator` — the 60s job timeout is currently enforced by
   * BullMQ retry policy (phase 03), not by client-side abort.
   */
  signal?: AbortSignal
}): Promise<GenerationResult> {
  const { orgId, userId, recordId, fieldId } = params
  void params.signal

  const ctx = createFieldValueContext(orgId, userId, database)

  // 1. Load + gate the field
  const field = await getField(ctx, fieldId)
  if (!isAiField(field)) {
    throw new BadRequestError(`Field ${fieldId} does not have AI generation enabled`)
  }

  const aiOptions = (field.options as { ai?: { prompt?: unknown } } | null)?.ai
  const promptJson = aiOptions?.prompt as Parameters<typeof formulaToString>[0] | null | undefined
  if (!promptJson) {
    throw new BadRequestError(`Field ${fieldId} is missing an AI prompt`)
  }

  // 2. Extract refs
  const promptStr = formulaToString(promptJson)
  const fieldKeys = extractFieldIdsFromString(promptStr)

  // 3. Resolve refs (sibling + 1-hop relationships in one batchGetValues call)
  const resolved = await resolveReferences(ctx, { recordId, fieldKeys })

  // 4. Build final prompts
  const { resolvedPrompt, systemPrompt, truncated } = buildPrompt({
    promptJson,
    resolved,
    field,
  })
  if (truncated) {
    logger.warn('AI autofill prompt truncated at 32k chars', { fieldId, recordId })
  }

  // 5. Build output schema from field.type + options
  const jsonSchema = buildJsonSchema(field)

  // 6. Compute input hash for stale-detection BEFORE the LLM call so the
  //    hash is deterministic on success regardless of LLM output.
  const inputHash = computeInputHash({ promptJson, resolved })

  // 7. Resolve default LLM for this org
  const systemModels = new SystemModelService(database, orgId)
  const def = await systemModels.getDefault(ModelType.LLM)
  if (!def) {
    throw new BadRequestError('No default LLM configured for this organization')
  }

  // 8. Invoke. LLMOrchestrator handles quota enforcement + AiUsage tracking.
  const orchestrator = new LLMOrchestrator(new UsageTrackingService(database), database)
  const response = await orchestrator.invoke({
    model: def.model,
    provider: def.provider,
    organizationId: orgId,
    userId: userId ?? '',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: resolvedPrompt },
    ],
    structuredOutput: { enabled: true, schema: jsonSchema },
    context: { source: 'autofill', fieldId, recordId },
  })

  // 9. Unwrap the `{ value: ... }` envelope produced by buildJsonSchema.
  const structured = response.structured_output
  if (!structured || !('value' in structured)) {
    throw new BadRequestError('AI response did not match the expected structured output shape')
  }
  const value = (structured as { value: unknown }).value

  return {
    value,
    meta: {
      model: def.model,
      generatedAt: new Date().toISOString(),
      inputHash,
      tokens: response.usage
        ? {
            prompt: response.usage.prompt_tokens ?? 0,
            completion: response.usage.completion_tokens ?? 0,
          }
        : undefined,
    },
  }
}
