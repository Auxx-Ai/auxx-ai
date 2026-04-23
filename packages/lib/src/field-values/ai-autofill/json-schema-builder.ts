// packages/lib/src/field-values/ai-autofill/json-schema-builder.ts

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { CustomFieldEntity } from '@auxx/database/types'
import type { FieldOptions } from '../../custom-fields/field-options'
import { BadRequestError } from '../../errors'

/**
 * Permissive JSON-schema shape — the LLM orchestrator passes this through
 * to the provider verbatim, so we only need enough typing to construct it.
 */
export type JsonSchema = Record<string, unknown>

/**
 * Wrap a value schema in the `{ value: <schema> }` envelope the orchestrator's
 * `structuredOutput` path expects. Parsing the LLM's response then yields
 * `{ value: <generated value> }`, which `generation-service` unwraps.
 */
function wrap(valueSchema: JsonSchema, description?: string): JsonSchema {
  return {
    name: 'ai_autofill_result',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: {
        value: description ? { ...valueSchema, description } : valueSchema,
      },
    },
  }
}

/**
 * Build the `response_format.json_schema` for a field's native type.
 * The envelope is `{ value: T }` — the generation service reads `parsed.value`.
 *
 * Throws `BadRequestError` for non-AI-eligible types (caller should have
 * gated via `isAiEligible` before reaching here).
 */
export function buildJsonSchema(field: CustomFieldEntity): JsonSchema {
  const options = (field.options ?? {}) as FieldOptions

  switch (field.type) {
    case FieldTypeEnum.TEXT:
    case FieldTypeEnum.URL:
    case FieldTypeEnum.EMAIL:
      return wrap({ type: 'string' })

    case FieldTypeEnum.NUMBER:
      return wrap({ type: 'number' })

    case FieldTypeEnum.CHECKBOX:
      return wrap({ type: 'boolean' })

    case FieldTypeEnum.DATE:
      return wrap({ type: 'string', format: 'date' })

    case FieldTypeEnum.SINGLE_SELECT: {
      const ids = selectOptionIds(options)
      if (ids.length === 0) {
        throw new BadRequestError('SINGLE_SELECT field has no options to choose from')
      }
      return wrap({ type: 'string', enum: ids })
    }

    case FieldTypeEnum.MULTI_SELECT: {
      const ids = selectOptionIds(options)
      if (ids.length === 0) {
        throw new BadRequestError('MULTI_SELECT field has no options to choose from')
      }
      return wrap({
        type: 'array',
        items: { type: 'string', enum: ids },
      })
    }

    default:
      throw new BadRequestError(`AI generation is not supported for field type ${field.type}`)
  }
}

/**
 * Pull option ids out of a SELECT field's options. Falls back to `value`
 * when an option was defined without a stable `id` (older data shapes).
 */
function selectOptionIds(options: FieldOptions): string[] {
  const opts = options.options
  if (!Array.isArray(opts)) return []
  return opts.map((o) => o.id ?? o.value).filter((id): id is string => Boolean(id))
}
