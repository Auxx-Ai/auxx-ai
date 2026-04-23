// packages/lib/src/field-values/ai-autofill/preview-service.ts

import { database } from '@auxx/database'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import { SystemModelService } from '../../ai/providers/system-model-service'
import { ModelType } from '../../ai/providers/types'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { extractFieldIdsFromString, formulaToString } from '../../custom-fields/formula-converters'
import { BadRequestError } from '../../errors'
import { createFieldValueContext } from '../field-value-helpers'
import { buildJsonSchema } from './json-schema-builder'
import { buildPrompt } from './prompt-builder'
import { resolveReferences } from './reference-resolver'

const logger = createScopedLogger('ai-autofill:preview-service')

export interface PreviewResult {
  /** The user-facing prompt with references substituted. */
  resolvedPrompt: string
  /** LLM output, typed to match the field's native type. */
  value: unknown
  /** Whether the user prompt was truncated at the 32k cap. */
  truncated: boolean
  /** Token usage for telemetry — also recorded by the orchestrator. */
  tokens?: { prompt: number; completion: number }
  /** Model used, from the org's configured default LLM. */
  model?: string
}

/**
 * Dry-run AI generation for an in-dialog field definition. Runs the same
 * prompt → reference-resolve → LLM pipeline as {@link generateFieldValue}
 * but does not persist a `FieldValue` row, does not publish realtime
 * events, and does not require the field to already exist in the DB.
 *
 * Used by `customField.previewAi` so the create/edit dialog can show a
 * rendered value before saving the field.
 *
 * Quota is still consumed by the orchestrator (same `UsageGuard.consume`
 * + `AiUsage` audit row with `source: 'autofill-preview'`).
 */
export async function previewFieldValue(params: {
  orgId: string
  userId?: string
  /** A real record of the target entity type — used to resolve refs. */
  sampleRecordId: RecordId
  /** Native field type (TEXT / NUMBER / SINGLE_SELECT / …). */
  type: FieldType
  /** TipTap prompt JSON from the dialog. */
  promptJson: Parameters<typeof formulaToString>[0]
  /** Field options from the dialog — needed for SELECT enum + display. */
  options?: unknown
  /** Optional display name, used in the system prompt. */
  name?: string
}): Promise<PreviewResult> {
  const { orgId, userId, sampleRecordId, type, promptJson, options, name } = params

  if (!promptJson) {
    throw new BadRequestError('Preview requires a prompt')
  }

  const ctx = createFieldValueContext(orgId, userId, database)

  // Synthetic field object — good enough for prompt builder + json-schema
  // builder, which only read `name`, `type`, and `options`.
  const syntheticField = {
    id: 'preview',
    name: name ?? 'Preview field',
    type,
    options: options ?? null,
  } as unknown as CustomFieldEntity

  // 1. Extract + resolve references against the sample record
  const promptStr = formulaToString(promptJson)
  const fieldKeys = extractFieldIdsFromString(promptStr)
  const resolved = await resolveReferences(ctx, { recordId: sampleRecordId, fieldKeys })

  // 2. Build final prompts
  const { resolvedPrompt, systemPrompt, truncated } = buildPrompt({
    promptJson,
    resolved,
    field: syntheticField,
  })
  if (truncated) {
    logger.warn('AI preview prompt truncated at 32k chars', { sampleRecordId })
  }

  // 3. Build output schema from type + options
  const jsonSchema = buildJsonSchema(syntheticField)

  // 4. Resolve default LLM for this org
  const systemModels = new SystemModelService(database, orgId)
  const def = await systemModels.getDefault(ModelType.LLM)
  if (!def) {
    throw new BadRequestError('No default LLM configured for this organization')
  }

  // 5. Invoke the orchestrator. Quota + AiUsage logging handled inside.
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
    context: { source: 'autofill-preview', sampleRecordId },
  })

  const structured = response.structured_output
  if (!structured || !('value' in structured)) {
    throw new BadRequestError('AI response did not match the expected structured output shape')
  }

  return {
    resolvedPrompt,
    value: (structured as { value: unknown }).value,
    truncated,
    tokens: response.usage
      ? {
          prompt: response.usage.prompt_tokens ?? 0,
          completion: response.usage.completion_tokens ?? 0,
        }
      : undefined,
    model: def.model,
  }
}
