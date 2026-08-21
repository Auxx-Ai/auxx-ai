// packages/services/src/custom-fields/validate-ai-options.ts

import { database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import {
  type AiOptions,
  extractFieldIdsFromPrompt,
  isAiEligibleFieldType,
  promptHasContent,
  type SelectOption,
} from '@auxx/types/custom-field'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'

export interface AiOptionsValidationError {
  code: 'VALIDATION_ERROR'
  message: string
}

export interface ValidateAiOptionsInput {
  organizationId: string
  /** The STORED field type. Wider than `FieldType`: the `ContactFieldType`
   *  column still carries the legacy `PHONE` value that the TS vocabulary
   *  dropped in favour of `PHONE_INTL`, so an existing row can present one. */
  type: CustomFieldEntity['type']
  /** `options.ai` parsed from the incoming create/update payload. `undefined`
   *  when the caller did not set an AI block — no validation runs. */
  ai: AiOptions | undefined
  /** SINGLE_SELECT / MULTI_SELECT / TAGS option set at save time. Empty or
   *  missing on an AI-enabled select rejects — except an open TAGS field
   *  (`ai.allowNewOptions`), which is allowed to start from nothing. */
  selectOptions?: SelectOption[]
  /** Field id being updated, so we don't flag self-references against the
   *  updated field's own AI state. `undefined` on create. */
  selfFieldId?: string
}

/**
 * Validate an `options.ai` block at field create/update time.
 *
 * Rules (per toggle-04 plan):
 *   1. `enabled=true` is only allowed on AI-eligible field types.
 *   2. Prompt must contain non-empty text or at least one field reference.
 *   3. SINGLE_SELECT / MULTI_SELECT / constrained TAGS require a non-empty
 *      options list.
 *   4. Prompt may not reference any other AI-enabled field in the org
 *      (no AI→AI chains — decision T4.2).
 *
 * Returns `ok()` when the `ai` block is absent or `enabled=false` — both are
 * no-ops from the validator's perspective.
 */
export async function validateAiOptions(
  input: ValidateAiOptionsInput
): Promise<Result<void, AiOptionsValidationError>> {
  const { organizationId, type, ai, selectOptions, selfFieldId } = input

  if (!ai || !ai.enabled) return ok(undefined)

  if (!isAiEligibleFieldType(type)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: `Field type ${type} cannot have AI generation enabled`,
    })
  }

  if (!promptHasContent(ai.prompt)) {
    return err({ code: 'VALIDATION_ERROR', message: 'AI prompt cannot be empty' })
  }

  // An enum-backed schema over an empty option list is unsatisfiable, so the
  // generation would fail at the provider with an opaque error. Open TAGS is
  // exempt: it has no enum, and inventing the first tags is the whole point.
  const needsOptions =
    type === 'SINGLE_SELECT' ||
    type === 'MULTI_SELECT' ||
    (type === 'TAGS' && ai.allowNewOptions !== true)

  if (needsOptions && (!selectOptions || selectOptions.length === 0)) {
    return err({
      code: 'VALIDATION_ERROR',
      message: 'AI-enabled select fields require at least one option',
    })
  }

  const referencedFieldIds = extractFieldIdsFromPrompt(ai.prompt).filter((id) => id !== selfFieldId)

  if (referencedFieldIds.length > 0) {
    const siblings = await database
      .select({
        id: schema.CustomField.id,
        options: schema.CustomField.options,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.active, true)
        )
      )

    const aiSiblingIds = new Set(
      siblings
        .filter((f) => {
          const opts = f.options as { ai?: { enabled?: boolean } } | null | undefined
          return opts?.ai?.enabled === true
        })
        .map((f) => f.id)
    )

    for (const refId of referencedFieldIds) {
      if (aiSiblingIds.has(refId)) {
        return err({
          code: 'VALIDATION_ERROR',
          message: 'AI prompts cannot reference other AI-enabled fields',
        })
      }
    }
  }

  return ok(undefined)
}
