// packages/lib/src/custom-fields/ai.ts

import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import {
  type AiOptions,
  isAiEligibleFieldType,
  type RichReferencePrompt,
} from '@auxx/types/custom-field'
import { toFieldType } from '../field-values/stored-field-type'

/**
 * Whether a field type is in the AI-generatable whitelist.
 *
 * Source of truth is `AI_ELIGIBLE_FIELD_TYPES` in `@auxx/types/custom-field`,
 * coupled by an exact-set-equality test to the per-type contract table
 * `AI_TYPE_SPECS` in `field-values/ai-autofill/type-specs.ts`. This is the
 * gate the create/edit dialog renders on and the one services validates saves
 * against — there is no third list.
 */
export function isAiEligible(type: FieldType): boolean {
  return isAiEligibleFieldType(type)
}

/**
 * Whether a specific field has AI generation turned on. Combines the
 * type-level eligibility gate with the per-field `options.ai.enabled` flag.
 *
 * Multi-value scalar fields (`options.multi` — e.g. multi-value email/phone/
 * website) are NOT AI-generatable: the commit path is a whole-field replace,
 * so a generated value would wipe the stored alias list. This gates the whole
 * pipeline (enqueue short-circuit, worker generation, reference resolution).
 */
export function isAiField(field: CustomFieldEntity): boolean {
  if (!isAiEligible(toFieldType(field.type))) return false
  const options = field.options as { ai?: AiOptions; multi?: boolean } | null | undefined
  if (options?.multi === true) return false
  return options?.ai?.enabled === true
}

/**
 * Extract the stored AI prompt (TipTap JSON) from a field. Returns null
 * when AI is not enabled on the field.
 */
export function getAiPrompt(field: CustomFieldEntity): RichReferencePrompt | null {
  if (!isAiField(field)) return null
  const ai = (field.options as { ai?: AiOptions } | null | undefined)?.ai
  return ai?.prompt ?? null
}
