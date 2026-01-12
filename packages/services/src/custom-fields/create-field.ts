// packages/services/src/custom-fields/create-field.ts

import { database, schema } from '@auxx/database'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { getInverseCardinality } from '@auxx/utils'
import {
  ModelTypes,
  type ModelType,
  type RelationshipConfig,
  type RelationshipOptions,
  canFieldBeUnique,
  type SelectOption,
  type CurrencyOptions,
  type FileOptions,
  type DisplayOptions,
  supportsDisplayOptions,
  isDisplayOptions,
  mergeDisplayOptions,
} from './types'
import { FieldType as FieldTypeEnum, ModelTypeValues } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import type { CustomFieldEntity } from '@auxx/database/models'

/**
 * Input for creating a custom field
 * Extended to support RELATIONSHIP type with inverse config
 */
export interface CreateCustomFieldInput {
  organizationId: string
  name: string
  type: FieldType
  description?: string
  required?: boolean
  defaultValue?: string
  /** Field options - select options, file config, currency config, or flat display options */
  options?: SelectOption[] | { file: FileOptions } | { currency: CurrencyOptions } | DisplayOptions
  addressComponents?: string[]
  icon?: string
  isCustom?: boolean
  modelType?: ModelType
  entityDefinitionId?: string | null
  /** Relationship-specific options (required when type is RELATIONSHIP) */
  relationship?: RelationshipOptions
  /** Whether this field must contain unique values within its scope */
  isUnique?: boolean
}

/**
 * Get the last field by sortOrder for a scope (org/modelType/entityDefId)
 * Returns the field with highest sortOrder (lexicographically)
 */
async function getLastFieldSortOrder(
  organizationId: string,
  modelType: string,
  entityDefinitionId?: string | null
) {
  const conditions = [
    eq(schema.CustomField.organizationId, organizationId),
    eq(schema.CustomField.modelType, modelType as any),
  ]

  if (entityDefinitionId) {
    conditions.push(eq(schema.CustomField.entityDefinitionId, entityDefinitionId))
  } else {
    conditions.push(isNull(schema.CustomField.entityDefinitionId))
  }

  return database
    .select({ sortOrder: schema.CustomField.sortOrder })
    .from(schema.CustomField)
    .where(and(...conditions))
    .orderBy(desc(schema.CustomField.sortOrder))
    .limit(1)
}

/**
 * Create a new custom field
 * For RELATIONSHIP type, automatically creates the inverse field
 *
 * @param input - Field data
 * @returns Result with created field (or primary field for relationships)
 */
export async function createCustomField(input: CreateCustomFieldInput) {
  const {
    organizationId,
    name,
    type,
    description,
    required,
    defaultValue,
    options,
    addressComponents,
    icon,
    isCustom = true,
    modelType = ModelTypes.CONTACT,
    entityDefinitionId,
    relationship,
    isUnique = false,
  } = input

  // modelType is already lowercase and matches DB format directly
  const dbModelType = modelType

  // Validate isUnique is only set for allowed types
  if (isUnique) {
    const relationshipType = relationship?.relationshipType
    if (!canFieldBeUnique(type, relationshipType)) {
      return err({
        code: 'VALIDATION_ERROR' as const,
        message: `Field type ${type} cannot be marked as unique`,
      })
    }
  }

  // Handle RELATIONSHIP type specially
  if (type === FieldTypeEnum.RELATIONSHIP) {
    return createRelationshipFieldWithInverse({
      organizationId,
      name,
      description,
      icon,
      modelType,
      entityDefinitionId,
      relationship,
    })
  }

  // Build field options for non-relationship types
  const fieldOptions: Record<string, any> = {
    icon,
    isCustom,
  }

  if (
    type === FieldTypeEnum.SINGLE_SELECT ||
    type === FieldTypeEnum.MULTI_SELECT ||
    type === FieldTypeEnum.TAGS
  ) {
    if (options && Array.isArray(options)) {
      fieldOptions.options = options
    }
  }

  if (type === FieldTypeEnum.FILE) {
    if (options && !Array.isArray(options) && 'file' in options) {
      fieldOptions.file = options.file
    }
  }

  if (type === FieldTypeEnum.ADDRESS_STRUCT) {
    if (addressComponents) {
      fieldOptions.addressComponents = addressComponents
    }
  }

  if (type === FieldTypeEnum.CURRENCY) {
    if (options && !Array.isArray(options) && 'currency' in options) {
      fieldOptions.currency = (options as { currency: any }).currency
    }
  }

  // Handle flat display options for CHECKBOX, NUMBER, DATE, DATETIME, TIME, PHONE_INTL
  if (supportsDisplayOptions(type) && options && isDisplayOptions(options)) {
    Object.assign(fieldOptions, mergeDisplayOptions(type, options, {}))
  }

  // Get last field's sortOrder
  const lastFieldResult = await fromDatabase(
    getLastFieldSortOrder(organizationId, dbModelType, entityDefinitionId),
    'get-last-field-sort-order'
  )

  if (lastFieldResult.isErr()) {
    return lastFieldResult
  }

  const lastSortOrder = lastFieldResult.value[0]?.sortOrder ?? null
  const newSortOrder = generateKeyBetween(lastSortOrder, null)

  // Insert field
  const insertResult = await fromDatabase(
    database
      .insert(schema.CustomField)
      .values({
        name,
        type,
        description,
        required,
        defaultValue,
        options: fieldOptions,
        sortOrder: newSortOrder,
        organizationId,
        modelType: dbModelType as any,
        entityDefinitionId: entityDefinitionId || null,
        isUnique,
        updatedAt: new Date(),
      })
      .returning(),
    'create-custom-field'
  )

  if (insertResult.isErr()) {
    return insertResult
  }

  return ok(insertResult.value[0] as CustomFieldEntity)
}

/**
 * Internal function to create a relationship field with its inverse
 */
async function createRelationshipFieldWithInverse(input: {
  organizationId: string
  name: string
  description?: string
  icon?: string
  modelType: ModelType
  entityDefinitionId?: string | null
  relationship?: RelationshipOptions
}) {
  const {
    organizationId,
    name,
    description,
    icon,
    modelType,
    entityDefinitionId,
    relationship,
  } = input

  // Validate relationship options are provided
  if (!relationship) {
    return err({
      code: 'VALIDATION_ERROR' as const,
      message: 'Relationship options are required for RELATIONSHIP field type',
    })
  }

  const {
    relatedResourceId,
    relationshipType,
    inverseName,
    inverseDescription,
    inverseIcon,
  } = relationship

  // relatedResourceId is the unified ID - either a system ModelType or a custom entity UUID
  // Both are stored in relatedEntityDefinitionId for simplicity
  const relatedEntityDefinitionId = relatedResourceId

  if (!relatedEntityDefinitionId) {
    return err({
      code: 'VALIDATION_ERROR' as const,
      message: 'relatedResourceId must be specified for relationship fields',
    })
  }

  // Determine if this is a system resource or custom entity
  const isSystemModelType = (ModelTypeValues as readonly string[]).includes(relatedEntityDefinitionId)

  // modelType is already lowercase and matches DB format directly
  const dbModelType = modelType
  const inverseCardinality = getInverseCardinality(relationshipType)

  // Determine inverse field's modelType and entityDefinitionId
  // For system resources: modelType = the related system type (e.g., 'contact')
  // For custom entities: modelType = 'entity', entityDefinitionId = UUID
  const inverseModelType = isSystemModelType ? relatedEntityDefinitionId : 'entity'
  const inverseEntityDefinitionId = isSystemModelType ? null : relatedEntityDefinitionId

  // Execute in transaction
  const result = await fromDatabase(
    database.transaction(async (tx) => {
      // Get sortOrder for both sides
      const [primarySortResult, inverseSortResult] = await Promise.all([
        getLastFieldSortOrder(organizationId, dbModelType, entityDefinitionId),
        getLastFieldSortOrder(organizationId, inverseModelType, inverseEntityDefinitionId),
      ])

      const primarySortOrder = generateKeyBetween(primarySortResult[0]?.sortOrder ?? null, null)
      const inverseSortOrder = generateKeyBetween(inverseSortResult[0]?.sortOrder ?? null, null)

      // 1. Create primary field (without inverseFieldId yet)
      const primaryFieldResult = await tx
        .insert(schema.CustomField)
        .values({
          name,
          type: 'RELATIONSHIP',
          description,
          modelType: dbModelType as any,
          entityDefinitionId: entityDefinitionId || null,
          organizationId,
          sortOrder: primarySortOrder,
          updatedAt: new Date(),
          options: {
            icon,
            isCustom: true,
            relationship: {
              relatedEntityDefinitionId,
              inverseFieldId: null,
              relationshipType,
              isInverse: false,
            } as RelationshipConfig,
          },
        })
        .returning()

      const primaryField = primaryFieldResult[0]
      if (!primaryField) {
        throw new Error('Failed to create primary relationship field')
      }

      // 2. Create inverse field
      // For the inverse field, relatedEntityDefinitionId points back to the source:
      // - If source is system resource: use modelType (e.g., 'contact')
      // - If source is custom entity: use entityDefinitionId (UUID)
      const inverseRelatedEntityDefinitionId =
        modelType === ModelTypes.ENTITY ? entityDefinitionId! : dbModelType
      const inverseFieldResult = await tx
        .insert(schema.CustomField)
        .values({
          name: inverseName,
          type: 'RELATIONSHIP',
          description: inverseDescription,
          modelType: inverseModelType as any,
          entityDefinitionId: inverseEntityDefinitionId,
          organizationId,
          sortOrder: inverseSortOrder,
          updatedAt: new Date(),
          options: {
            icon: inverseIcon,
            isCustom: true,
            relationship: {
              relatedEntityDefinitionId: inverseRelatedEntityDefinitionId,
              inverseFieldId: primaryField.id,
              relationshipType: inverseCardinality,
              isInverse: true,
            } as RelationshipConfig,
          },
        })
        .returning()

      const inverseField = inverseFieldResult[0]
      if (!inverseField) {
        throw new Error('Failed to create inverse relationship field')
      }

      // 3. Update primary field with inverseFieldId
      const primaryOptions = primaryField.options as { relationship: RelationshipConfig }
      const updatedPrimaryFieldResult = await tx
        .update(schema.CustomField)
        .set({
          options: {
            ...primaryOptions,
            relationship: {
              ...primaryOptions.relationship,
              inverseFieldId: inverseField.id,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.CustomField.id, primaryField.id))
        .returning()

      const updatedPrimaryField = updatedPrimaryFieldResult[0]
      if (!updatedPrimaryField) {
        throw new Error('Failed to update primary relationship field')
      }

      return {
        primaryField: updatedPrimaryField as CustomFieldEntity,
        inverseField: inverseField as CustomFieldEntity,
      }
    }),
    'create-relationship-field'
  )

  // Return primary field for consistency with regular createCustomField
  if (result.isOk()) {
    return ok(result.value.primaryField)
  }
  return result
}
