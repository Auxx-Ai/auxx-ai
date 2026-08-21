// packages/lib/src/field-values/ai-autofill/json-schema-builder.ts

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { CustomFieldEntity } from '@auxx/database/types'
import type { FieldOptions } from '../../custom-fields/field-options'
import { BadRequestError } from '../../errors'
import {
  type AiFieldContext,
  allowsNewTagOptions,
  getAiTypeSpec,
  type JsonSchema,
  selectOptionIds,
} from './type-specs'

export type { JsonSchema } from './type-specs'

/**
 * Widen a value schema to admit `null`, the strict-mode form of "the model may
 * decline". `strict: true` forbids omitting `value`, so a nullable union is the
 * only way a provider-enforced schema can express "no confident answer" — and
 * without it the model is structurally unable to do anything but fabricate.
 */
function applyNullable(valueSchema: JsonSchema): JsonSchema {
  const next: JsonSchema = { ...valueSchema }

  const type = next.type
  if (typeof type === 'string') {
    next.type = [type, 'null']
  } else if (Array.isArray(type) && !type.includes('null')) {
    next.type = [...type, 'null']
  }

  // An `enum` is exhaustive under strict mode, so `null` has to join it too.
  if (Array.isArray(next.enum) && !next.enum.includes(null)) {
    next.enum = [...next.enum, null]
  }

  return next
}

/**
 * Wrap a value schema in the `{ value: <schema> }` envelope the orchestrator's
 * `structuredOutput` path expects. Parsing the LLM's response then yields
 * `{ value: <generated value> }`, which `generation-service` unwraps.
 */
function wrap(valueSchema: JsonSchema, opts?: { nullable?: boolean }): JsonSchema {
  return {
    name: 'ai_autofill_result',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: {
        value: opts?.nullable ? applyNullable(valueSchema) : valueSchema,
      },
    },
  }
}

/**
 * Build the `response_format.json_schema` for a field's native type, from the
 * type's entry in `AI_TYPE_SPECS`. The envelope is `{ value: T }` — the
 * generation service reads `parsed.value`.
 *
 * Throws `BadRequestError` for non-AI-eligible types (caller should have
 * gated via `isAiEligible` before reaching here).
 */
export function buildJsonSchema(field: CustomFieldEntity, ctx?: AiFieldContext): JsonSchema {
  const options = (field.options ?? {}) as FieldOptions

  // Multi-value scalar fields are gated off autofill entirely (`isAiField`):
  // the commit path is a whole-field replace, so a generated value would wipe
  // the stored list. Defense in depth for callers that skipped the gate.
  if (options.multi === true) {
    throw new BadRequestError('AI generation is not supported for multi-value fields')
  }

  const spec = getAiTypeSpec(field.type)
  if (!spec) {
    throw new BadRequestError(`AI generation is not supported for field type ${field.type}`)
  }

  assertEnumerable(field, options)

  return wrap(spec.schema(field, ctx), { nullable: spec.nullable })
}

/**
 * Reject enum-backed types whose option list is empty before the schema is
 * built — a `{ enum: [] }` is a schema no output can satisfy, so the provider
 * error would surface as an opaque generation failure instead of a clear
 * "this field has no options" message.
 *
 * An open TAGS field (`ai.allowNewOptions`) has no enum, so it is exempt.
 */
function assertEnumerable(field: CustomFieldEntity, options: FieldOptions): void {
  const needsOptions =
    field.type === FieldTypeEnum.SINGLE_SELECT ||
    field.type === FieldTypeEnum.MULTI_SELECT ||
    (field.type === FieldTypeEnum.TAGS && !allowsNewTagOptions(field))

  if (needsOptions && selectOptionIds(options).length === 0) {
    throw new BadRequestError(`${field.type} field has no options to choose from`)
  }
}
