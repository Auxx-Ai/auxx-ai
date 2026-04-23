// packages/lib/src/custom-fields/ai.ts

import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import {
  type AiOptions,
  isAiEligibleFieldType,
  type RichReferencePrompt,
} from '@auxx/types/custom-field'

/**
 * Whether a field type is in the AI-generatable whitelist.
 *
 * v1 eligible: TEXT, NUMBER, CHECKBOX, DATE, URL, EMAIL, SINGLE_SELECT,
 * MULTI_SELECT. Source of truth is `AI_ELIGIBLE_FIELD_TYPES` in
 * `@auxx/types/custom-field`; the `canAiGenerate` flag on `fieldTypeOptions`
 * must stay in sync for the UI gating path.
 */
export function isAiEligible(type: FieldType): boolean {
  return isAiEligibleFieldType(type)
}

/**
 * Whether a specific field has AI generation turned on. Combines the
 * type-level eligibility gate with the per-field `options.ai.enabled` flag.
 */
export function isAiField(field: CustomFieldEntity): boolean {
  if (!isAiEligible(field.type)) return false
  const ai = (field.options as { ai?: AiOptions } | null | undefined)?.ai
  return ai?.enabled === true
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
