// packages/services/src/custom-fields/update-field.ts

import { database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import type { AiOptions } from '@auxx/types/custom-field'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { checkExistingDuplicates } from './check-unique-value'
import type { CustomFieldNotFoundError } from './errors'
import {
  type ActorOptions,
  canFieldBeUnique,
  type DisplayOptions,
  type FileOptions,
  getInverseFieldId,
  isDisplayOptions,
  mergeDisplayOptions,
  type RelationshipConfig,
  type SelectOption,
  supportsDisplayOptions,
} from './types'
import { validateAiOptions } from './validate-ai-options'

function pickAiOptions(options: unknown): AiOptions | undefined {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined
  const ai = (options as { ai?: unknown }).ai
  return ai as AiOptions | undefined
}

function pickSelectOptions(options: unknown): SelectOption[] | undefined {
  if (!options) return undefined
  if (Array.isArray(options)) return options as SelectOption[]
  if (typeof options === 'object') {
    const inner = (options as { options?: unknown }).options
    if (Array.isArray(inner)) return inner as SelectOption[]
  }
  return undefined
}

/**
 * Input for updating a custom field
 */
export interface UpdateCustomFieldInput {
  resourceFieldId: ResourceFieldId
  organizationId: string
  name?: string
  description?: string
  required?: boolean
  defaultValue?: string
  /** Field options - select options, file config, flat display options
   *  (incl. CURRENCY), or `{ options, ai }` for AI-enabled selects. */
  options?:
    | SelectOption[]
    | { file: FileOptions }
    | { options: SelectOption[]; ai?: AiOptions }
    | (DisplayOptions & { ai?: AiOptions })
  addressComponents?: string[]
  icon?: string
  isCustom?: boolean
  active?: boolean
  position?: number
  type?: FieldType
  /** Whether this field must contain unique values within its scope */
  isUnique?: boolean
  /** Update the inverse relationship field's name (RELATIONSHIP type only) */
  inverseName?: string
}

/**
 * Update an existing custom field
 *
 * @param input - Field data to update
 * @returns Result with updated field
 */
export async function updateCustomField(input: UpdateCustomFieldInput) {
  const { resourceFieldId, organizationId, options, addressComponents, type, isUnique, ...data } =
    input

  // Parse ResourceFieldId to get components
  const { fieldId: id } = parseResourceFieldId(resourceFieldId)

  // Get current field
  const currentResult = await fromDatabase(
    database
      .select({
        type: schema.CustomField.type,
        options: schema.CustomField.options,
        isUnique: schema.CustomField.isUnique,
        modelType: schema.CustomField.modelType,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
        systemAttribute: schema.CustomField.systemAttribute,
      })
      .from(schema.CustomField)
      .where(
        and(eq(schema.CustomField.id, id), eq(schema.CustomField.organizationId, organizationId))
      )
      .limit(1),
    'get-current-field'
  )

  if (currentResult.isErr()) {
    return currentResult
  }

  const currentField = currentResult.value[0]
  if (!currentField) {
    return err({
      code: 'CUSTOM_FIELD_NOT_FOUND',
      message: 'Field not found',
      fieldId: id as string,
    } as CustomFieldNotFoundError)
  }

  const fieldType = type || currentField.type

  // Validate isUnique if being changed
  if (isUnique !== undefined) {
    // Check if field type supports uniqueness
    const relationshipType = (
      currentField.options as { relationship?: { relationshipType?: string } }
    )?.relationship?.relationshipType as 'belongs_to' | 'has_one' | 'has_many' | undefined

    if (isUnique && !canFieldBeUnique(fieldType, relationshipType)) {
      return err({
        code: 'VALIDATION_ERROR' as const,
        message: `Field type ${fieldType} cannot be marked as unique`,
      })
    }

    // If enabling uniqueness, check for existing duplicates
    if (isUnique && !currentField.isUnique) {
      const hasDuplicates = await checkExistingDuplicates(
        id,
        organizationId,
        currentField.modelType,
        currentField.entityDefinitionId
      )
      if (hasDuplicates) {
        return err({
          code: 'VALIDATION_ERROR' as const,
          message: 'Cannot enable uniqueness: duplicate values exist for this field',
        })
      }
    }
  }

  // Validate options.ai (if the caller is touching it). Uses the caller's
  // new options when present, else falls back to what's already stored —
  // so re-saving a field without touching AI doesn't re-validate it.
  const incomingAi = pickAiOptions(options)
  const currentAi = (currentField.options as { ai?: AiOptions } | null | undefined)?.ai
  const effectiveAi = options !== undefined ? incomingAi : currentAi
  const aiWasEnabled = currentAi?.enabled === true
  const aiWillBeEnabled = effectiveAi?.enabled === true

  if (options !== undefined) {
    const selectOpts =
      pickSelectOptions(options) ??
      (currentField.options as { options?: SelectOption[] } | null | undefined)?.options
    const aiValidation = await validateAiOptions({
      organizationId,
      type: fieldType,
      ai: incomingAi,
      selectOptions: selectOpts,
      selfFieldId: id,
    })
    if (aiValidation.isErr()) {
      return aiValidation
    }
  }

  // Build updated options
  let updatedOptions: Record<string, any> | undefined

  if (options !== undefined || addressComponents !== undefined) {
    let fieldOptions: Record<string, any> = {
      icon: input.icon,
      isCustom: input.isCustom,
    }

    if (currentField.options && typeof currentField.options === 'object') {
      fieldOptions = { ...currentField.options, ...fieldOptions }
    }

    if (
      fieldType === FieldTypeEnum.SINGLE_SELECT ||
      fieldType === FieldTypeEnum.MULTI_SELECT ||
      fieldType === FieldTypeEnum.TAGS
    ) {
      const selectOpts = options !== undefined ? pickSelectOptions(options) : undefined
      if (selectOpts) {
        fieldOptions.options = selectOpts
      }
    }

    if (fieldType === FieldTypeEnum.FILE) {
      if (options !== undefined && !Array.isArray(options) && 'file' in options) {
        fieldOptions.file = options.file
      }
    }

    if (fieldType === FieldTypeEnum.ACTOR) {
      if (options !== undefined && !Array.isArray(options) && 'actor' in options) {
        const actorOpts = (options as { actor: ActorOptions }).actor

        // Merge with existing actor options (allow partial updates)
        const existingActor = (currentField.options as { actor?: ActorOptions })?.actor
        fieldOptions.actor = {
          ...existingActor,
          ...actorOpts,
        }

        // Don't allow changing target or multiple in edit mode
        // (These are structural and changing them could cause data issues)
        if (existingActor) {
          fieldOptions.actor.target = existingActor.target
          fieldOptions.actor.multiple = existingActor.multiple
        }
      }
    }

    if (fieldType === FieldTypeEnum.ADDRESS_STRUCT) {
      if (addressComponents !== undefined) {
        fieldOptions.addressComponents = addressComponents
      }
    }

    // Handle flat display options for CHECKBOX, NUMBER, DATE, DATETIME, TIME, PHONE_INTL
    if (supportsDisplayOptions(fieldType) && options !== undefined && isDisplayOptions(options)) {
      Object.assign(fieldOptions, mergeDisplayOptions(fieldType, options, {}))
    }

    // Handle options.ai: when caller provides options, incomingAi is the
    // source of truth (undefined or enabled=false both strip the marker).
    // When caller doesn't touch options at all, preserve whatever was stored.
    if (options !== undefined) {
      if (incomingAi) {
        fieldOptions.ai = incomingAi
      } else {
        delete (fieldOptions as { ai?: unknown }).ai
      }
    }

    updatedOptions = fieldOptions
  }

  const updateData: Record<string, any> = { ...data }
  if (updatedOptions !== undefined) {
    updateData.options = updatedOptions
  }
  if (isUnique !== undefined) {
    updateData.isUnique = isUnique
  }

  // CRITICAL: Ensure systemAttribute is never updated
  // System attribute designation is immutable once set
  delete updateData.systemAttribute

  // Check if we need to update inverse field name (RELATIONSHIP type only)
  const relationshipConfig = currentField.options as { relationship?: RelationshipConfig }
  const inverseFieldId = relationshipConfig?.relationship
    ? getInverseFieldId(relationshipConfig.relationship)
    : null

  // If updating inverse name for a relationship field, use a transaction
  if (fieldType === FieldTypeEnum.RELATIONSHIP && input.inverseName && inverseFieldId) {
    const txResult = await fromDatabase(
      database.transaction(async (tx) => {
        // Update primary field
        const [primaryField] = await tx
          .update(schema.CustomField)
          .set(updateData)
          .where(
            and(
              eq(schema.CustomField.id, id),
              eq(schema.CustomField.organizationId, organizationId)
            )
          )
          .returning()

        // Update inverse field name
        await tx
          .update(schema.CustomField)
          .set({ name: input.inverseName, updatedAt: new Date() })
          .where(
            and(
              eq(schema.CustomField.id, inverseFieldId),
              eq(schema.CustomField.organizationId, organizationId)
            )
          )

        return primaryField
      }),
      'update-custom-field-with-inverse'
    )

    if (txResult.isErr()) {
      return txResult
    }

    return ok(txResult.value as CustomFieldEntity)
  }

  // Standard update (non-relationship or no inverse name change)
  const updateResult = await fromDatabase(
    database
      .update(schema.CustomField)
      .set(updateData)
      .where(
        and(eq(schema.CustomField.id, id), eq(schema.CustomField.organizationId, organizationId))
      )
      .returning(),
    'update-custom-field'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  // Toggle-off: if AI was enabled on this field and no longer is, clear the
  // aiStatus marker on all of its FieldValue rows. `valueJson` is left
  // intact — readers gate on `aiStatus IS NOT NULL`, so stale metadata
  // becomes invisible without destroying typed values that v2 types may
  // store in valueJson alongside AI metadata.
  if (aiWasEnabled && !aiWillBeEnabled) {
    await fromDatabase(
      database
        .update(schema.FieldValue)
        .set({ aiStatus: null })
        .where(
          and(
            eq(schema.FieldValue.fieldId, id),
            eq(schema.FieldValue.organizationId, organizationId)
          )
        ),
      'clear-ai-status-on-toggle-off'
    )
  }

  return ok(updateResult.value[0] as CustomFieldEntity)
}
