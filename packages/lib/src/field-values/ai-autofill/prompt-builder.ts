// packages/lib/src/field-values/ai-autofill/prompt-builder.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import { type FormulaNode, formulaToString } from '../../custom-fields/formula-converters'
import type { ResolvedReference } from './reference-resolver'
import { type AiFieldContext, getAiTypeSpec } from './type-specs'

/** 32k char cap on the assembled user prompt (decision T4.5). */
const MAX_USER_PROMPT_CHARS = 32_000

/** Marker injected at the tail of a truncated prompt so the model sees the clip. */
const TRUNCATION_MARKER = '\n…[truncated]'

export interface BuiltPrompt {
  /** User-facing message body with `{fieldKey}` badges substituted for display values. */
  resolvedPrompt: string
  /** Internal system prompt — users never see or edit this (decision T4.7). */
  systemPrompt: string
  /** True when the user prompt exceeded the cap and was truncated. */
  truncated: boolean
}

/**
 * Assemble the final LLM-facing prompt pair from a stored TipTap prompt and
 * the resolved references for a given record.
 */
export function buildPrompt(params: {
  promptJson: FormulaNode
  resolved: Map<string, ResolvedReference>
  field: CustomFieldEntity
  /** Values the shape hint cannot derive from the field alone (org currency). */
  context?: AiFieldContext
}): BuiltPrompt {
  const { promptJson, resolved, field, context } = params

  const template = formulaToString(promptJson)

  // Substitute `{fieldKey}` with the ResolvedReference.displayValue.
  // Unknown keys fall through as empty string (T4.3).
  const substituted = template.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const ref = resolved.get(key.trim())
    return ref?.displayValue ?? ''
  })

  const { text, truncated } = truncateToCap(substituted.trim(), MAX_USER_PROMPT_CHARS)

  return {
    resolvedPrompt: text,
    systemPrompt: buildSystemPrompt(field, context),
    truncated,
  }
}

function truncateToCap(input: string, max: number): { text: string; truncated: boolean } {
  if (input.length <= max) return { text: input, truncated: false }
  const keep = Math.max(0, max - TRUNCATION_MARKER.length)
  return { text: `${input.slice(0, keep)}${TRUNCATION_MARKER}`, truncated: true }
}

/**
 * Static system prompt tailored to the field's native type. Tells the model
 * how to format the value so the `json_schema` envelope parses cleanly.
 *
 * The shape line and the refusal line both come from the field type's entry in
 * `AI_TYPE_SPECS`, so the natural-language contract cannot drift from the
 * machine contract the provider enforces.
 */
function buildSystemPrompt(field: CustomFieldEntity, context?: AiFieldContext): string {
  const spec = getAiTypeSpec(field.type)
  return [
    'You generate values for fields on business records.',
    'Read the user instructions carefully, honour any referenced field values,',
    'and return ONLY the JSON envelope requested by the response schema.',
    `Field name: "${field.name}"`,
    spec?.shapeHint(field, context) ?? '',
    // A nullable type's schema admits `null`, so "return the most reasonable
    // value rather than refusing" would push the model into fabricating one —
    // the exact failure the null branch exists to prevent.
    spec?.nullable
      ? 'If the instructions do not contain the information, return null. Never invent a value.'
      : 'If you cannot produce a confident answer, return the most reasonable value\nthat fits the schema rather than refusing.',
  ].join('\n')
}
