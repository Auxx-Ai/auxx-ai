// packages/services/src/custom-fields/update-field.ts

import { database, schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import type { CustomFieldNotFoundError } from './errors'
import type { CustomFieldEntity } from '@auxx/database/models'
import {
  canFieldBeUnique,
  type SelectOption,
  type CurrencyOptions,
  type FileOptions,
  type DisplayOptions,
} from './types'
import { checkExistingDuplicates } from './check-unique-value'

/**
 * Input for updating a custom field
 */
export interface UpdateCustomFieldInput {
  id: string
  organizationId: string
  name?: string
  description?: string
  required?: boolean
  defaultValue?: string
  /** Field options - select options, file config, currency config, or flat display options */
  options?:
    | SelectOption[]
    | { file: FileOptions }
    | { currency: CurrencyOptions }
    | DisplayOptions
  addressComponents?: string[]
  icon?: string
  isCustom?: boolean
  active?: boolean
  position?: number
  type?: FieldType
  /** Whether this field must contain unique values within its scope */
  isUnique?: boolean
}

/**
 * Update an existing custom field
 *
 * @param input - Field data to update
 * @returns Result with updated field
 */
export async function updateCustomField(input: UpdateCustomFieldInput) {
  const { id, organizationId, options, addressComponents, type, isUnique, ...data } = input

  // Get current field
  const currentResult = await fromDatabase(
    database
      .select({
        type: schema.CustomField.type,
        options: schema.CustomField.options,
        isUnique: schema.CustomField.isUnique,
        modelType: schema.CustomField.modelType,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
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
      fieldId: id,
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
      if (options !== undefined && Array.isArray(options)) {
        fieldOptions.options = options
      }
    }

    if (fieldType === FieldTypeEnum.FILE) {
      if (options !== undefined && !Array.isArray(options) && 'file' in options) {
        fieldOptions.file = options.file
      }
    }

    if (fieldType === FieldTypeEnum.CURRENCY) {
      if (options !== undefined && !Array.isArray(options) && 'currency' in options) {
        fieldOptions.currency = options.currency
      }
    }

    if (fieldType === FieldTypeEnum.ADDRESS_STRUCT) {
      if (addressComponents !== undefined) {
        fieldOptions.addressComponents = addressComponents
      }
    }

    // Handle flat display options for CHECKBOX, NUMBER, DATE, DATETIME, TIME, PHONE_INTL
    if (
      fieldType === FieldTypeEnum.CHECKBOX ||
      fieldType === FieldTypeEnum.NUMBER ||
      fieldType === FieldTypeEnum.DATE ||
      fieldType === FieldTypeEnum.DATETIME ||
      fieldType === FieldTypeEnum.TIME ||
      fieldType === FieldTypeEnum.PHONE_INTL
    ) {
      if (options !== undefined && !Array.isArray(options) && !('file' in options) && !('currency' in options)) {
        // Merge flat display options directly into fieldOptions
        const displayOpts = options as DisplayOptions
        if (displayOpts.checkboxStyle !== undefined) fieldOptions.checkboxStyle = displayOpts.checkboxStyle
        if (displayOpts.trueLabel !== undefined) fieldOptions.trueLabel = displayOpts.trueLabel
        if (displayOpts.falseLabel !== undefined) fieldOptions.falseLabel = displayOpts.falseLabel
        if (displayOpts.decimals !== undefined) fieldOptions.decimals = displayOpts.decimals
        if (displayOpts.useGrouping !== undefined) fieldOptions.useGrouping = displayOpts.useGrouping
        if (displayOpts.displayAs !== undefined) fieldOptions.displayAs = displayOpts.displayAs
        if (displayOpts.prefix !== undefined) fieldOptions.prefix = displayOpts.prefix
        if (displayOpts.suffix !== undefined) fieldOptions.suffix = displayOpts.suffix
        if (displayOpts.format !== undefined) fieldOptions.format = displayOpts.format
        if (displayOpts.timeFormat !== undefined) fieldOptions.timeFormat = displayOpts.timeFormat
        if (displayOpts.includeTime !== undefined) fieldOptions.includeTime = displayOpts.includeTime
        if (displayOpts.phoneFormat !== undefined) fieldOptions.phoneFormat = displayOpts.phoneFormat
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

  // Update field
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

  return ok(updateResult.value[0] as CustomFieldEntity)
}
