// packages/lib/src/import/fields/ai-auto-map-columns.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { SystemModelService } from '../../ai/providers/system-model-service'
import { ModelType } from '../../ai/providers/types'
import type { LLMInvocationRequest } from '../../ai/orchestrator/types'
import type { AIColumnMappingInput, AIColumnMappingResult } from '../types/ai-mapping'
import { suggestResolutionType } from './suggest-resolution-type'
import type { ImportableField } from './get-importable-fields'

const logger = createScopedLogger('ai-auto-map-columns')

/** Default fallback model if user has no default configured */
const FALLBACK_PROVIDER = 'openai'
const FALLBACK_MODEL = 'gpt-4o-mini'

/**
 * Prompt template for AI column mapping
 * Uses structured output for reliable parsing
 */
const COLUMN_MAPPING_PROMPT = `You are a data import assistant. Your task is to map CSV column headers to database fields.

## Target Entity: {{TARGET_TABLE}}

## Available Database Fields:
{{FIELDS_JSON}}

## CSV Columns to Map:
{{COLUMNS_JSON}}

## Instructions:
1. For each CSV column, find the best matching database field based on:
   - Column header name similarity
   - Sample values (use these to understand the data type and content)
   - Field type compatibility

2. Consider:
   - "fname" or "first" likely maps to "firstName"
   - "email_address" or "mail" likely maps to "email"
   - Look at sample values: if they look like emails, map to email field
   - If sample values are phone-formatted, map to phone field
   - If no good match exists, set matchedFieldKey to null

3. Each database field can only be mapped once (no duplicates)

4. Return ONLY a valid JSON array, no markdown or explanation:

[
  {
    "columnIndex": 0,
    "matchedFieldKey": "firstName" | null,
    "confidence": 0.95,
    "reasoning": "Header 'First Name' directly matches field label"
  },
  ...
]

Confidence guidelines:
- 1.0: Exact match in name
- 0.9-0.99: Very high confidence (clear abbreviation or synonym)
- 0.7-0.89: High confidence (sample values strongly suggest this field)
- 0.5-0.69: Medium confidence (reasonable guess)
- Below 0.5: Don't map (set matchedFieldKey to null)`

/**
 * AI-powered column mapping using LLM.
 * Uses user's default LLM model from SystemModelService.
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param userId - User ID
 * @param input - Column mapping input data
 * @returns Array of column mapping results
 */
export async function aiAutoMapColumns(
  db: Database,
  organizationId: string,
  userId: string,
  input: AIColumnMappingInput
): Promise<AIColumnMappingResult[]> {
  // Get user's default LLM model
  const systemModelService = new SystemModelService(db, organizationId)
  const defaultModel = await systemModelService.getDefault(ModelType.LLM)

  const provider = defaultModel?.provider ?? FALLBACK_PROVIDER
  const model = defaultModel?.model ?? FALLBACK_MODEL

  logger.info('Using LLM for column mapping', { provider, model, organizationId })

  const usageService = new UsageTrackingService(db)
  const orchestrator = new LLMOrchestrator(usageService, db, {
    enableUsageTracking: true,
    defaultProvider: provider,
    defaultModel: model,
  })

  // Build the prompt with actual data
  const fieldsJson = JSON.stringify(
    input.targetFields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.options?.slice(0, 5), // Limit options for context
    })),
    null,
    2
  )

  const columnsJson = JSON.stringify(
    input.columns.map((c) => ({
      index: c.index,
      header: c.name,
      samples: c.sampleValues.slice(0, 3), // Limit samples for token efficiency
    })),
    null,
    2
  )

  const prompt = COLUMN_MAPPING_PROMPT.replace('{{TARGET_TABLE}}', input.entityDefinitionId)
    .replace('{{FIELDS_JSON}}', fieldsJson)
    .replace('{{COLUMNS_JSON}}', columnsJson)

  const request: LLMInvocationRequest = {
    model,
    provider,
    messages: [
      {
        role: 'system',
        content: 'You are a precise data mapping assistant. Output only valid JSON arrays.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    parameters: {
      max_tokens: 1500,
      temperature: 0.1, // Low temperature for consistent results
    },
    organizationId,
    userId,
    context: {
      source: 'data-import',
      operation: 'auto-map-columns',
    },
  }

  logger.info('Invoking AI for column mapping', {
    organizationId,
    columnCount: input.columns.length,
    fieldCount: input.targetFields.length,
  })

  const response = await orchestrator.invoke(request)

  // Parse the AI response
  const aiMappings = parseAIResponse(response.content, input)

  // Add resolution types based on matched fields
  const fieldsMap = new Map(input.targetFields.map((f) => [f.key, f]))

  return aiMappings.map((mapping) => {
    const field = mapping.matchedFieldKey ? fieldsMap.get(mapping.matchedFieldKey) : null
    return {
      ...mapping,
      columnName: input.columns[mapping.columnIndex]?.name ?? '',
      resolutionType: field ? suggestResolutionType(field as ImportableField) : 'text:value',
    }
  })
}

/**
 * Parse and validate AI response.
 *
 * @param content - Raw AI response content
 * @param input - Original input for validation
 * @returns Parsed column mapping results (without columnName and resolutionType)
 */
function parseAIResponse(
  content: string,
  input: AIColumnMappingInput
): Omit<AIColumnMappingResult, 'columnName' | 'resolutionType'>[] {
  try {
    // Clean potential markdown wrapping
    let cleaned = content.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned
        .replace(/```(?:json)?\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim()
    }

    const parsed = JSON.parse(cleaned)

    if (!Array.isArray(parsed)) {
      throw new Error('Expected array response')
    }

    // Validate and normalize
    const validFieldKeys = new Set(input.targetFields.map((f) => f.key))
    const usedFields = new Set<string>()

    return parsed.map((item: Record<string, unknown>) => {
      const columnIndex = Number(item.columnIndex)
      let matchedFieldKey = item.matchedFieldKey as string | null

      // Validate field key exists and isn't already used
      if (
        matchedFieldKey &&
        (!validFieldKeys.has(matchedFieldKey) || usedFields.has(matchedFieldKey))
      ) {
        matchedFieldKey = null
      }

      if (matchedFieldKey) {
        usedFields.add(matchedFieldKey)
      }

      return {
        columnIndex,
        matchedFieldKey,
        confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
        reasoning: item.reasoning as string | undefined,
      }
    })
  } catch (error) {
    logger.error('Failed to parse AI response', { error, content })
    throw new Error('Invalid AI response format')
  }
}
