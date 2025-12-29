// packages/services/src/custom-fields/create-field.ts

import { database, schema } from '@auxx/database'
import { eq, and, desc } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import {
  ModelTypes,
  type ModelType,
  type RelationshipConfig,
  type RelationshipOptions,
  canFieldBeUnique,
  type SelectOption,
  type CurrencyOptions,
  type FileOptions,
} from './types'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
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
  options?: SelectOption[] | { file: FileOptions } | { currency: CurrencyOptions }
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
 * Get inverse cardinality for a relationship type
 */
function getInverseCardinality(
  type: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
): 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many' {
  switch (type) {
    case 'belongs_to':
      return 'has_many'
    case 'has_one':
      return 'has_one'
    case 'has_many':
      return 'belongs_to'
    case 'many_to_many':
      return 'many_to_many' // Symmetric - both sides are many_to_many
  }
}

/**
 * Get highest position for a model type
 */
async function getHighestPosition(
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
  }

  return database
    .select({ position: schema.CustomField.position })
    .from(schema.CustomField)
    .where(and(...conditions))
    .orderBy(desc(schema.CustomField.position))
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

  // Get highest position
  const positionResult = await fromDatabase(
    database
      .select({ position: schema.CustomField.position })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.modelType, dbModelType as any)
        )
      )
      .orderBy(desc(schema.CustomField.position))
      .limit(1),
    'get-highest-position'
  )

  if (positionResult.isErr()) {
    return positionResult
  }

  const highestPosition = positionResult.value[0]?.position ?? -1

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
        position: highestPosition + 1,
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
    displayFieldId,
    inverseName,
    inverseDescription,
    inverseIcon,
    inverseDisplayFieldId,
  } = relationship

  // Start with legacy values if provided
  let relatedModelType = relationship.relatedModelType
  let relatedEntityDefinitionId = relationship.relatedEntityDefinitionId

  // Handle unified relatedResourceId format (preferred over legacy fields)
  if (relatedResourceId) {
    if (relatedResourceId.startsWith('entity_')) {
      // Custom entity - need to look up entityDefinitionId by apiSlug
      const apiSlug = relatedResourceId.replace('entity_', '')
      const entityDef = await database.query.EntityDefinition.findFirst({
        where: (defs, { eq, and }) =>
          and(eq(defs.apiSlug, apiSlug), eq(defs.organizationId, organizationId)),
      })
      if (!entityDef) {
        return err({
          code: 'NOT_FOUND' as const,
          message: `Entity definition not found: ${apiSlug}`,
        })
      }
      relatedEntityDefinitionId = entityDef.id
      relatedModelType = null
    } else {
      // System resource - relatedResourceId IS the ModelType
      relatedModelType = relatedResourceId as ModelType
      relatedEntityDefinitionId = null
    }
  }

  // Validate: exactly one of relatedModelType or relatedEntityDefinitionId
  const hasModelType = relatedModelType !== null && relatedModelType !== undefined
  const hasEntityDef = relatedEntityDefinitionId !== null && relatedEntityDefinitionId !== undefined

  if (!hasModelType && !hasEntityDef) {
    return err({
      code: 'VALIDATION_ERROR' as const,
      message: 'Either relatedModelType, relatedEntityDefinitionId, or relatedResourceId must be specified',
    })
  }
  if (hasModelType && hasEntityDef) {
    return err({
      code: 'VALIDATION_ERROR' as const,
      message: 'Cannot specify both relatedModelType and relatedEntityDefinitionId',
    })
  }

  // modelType is already lowercase and matches DB format directly
  const dbModelType = modelType
  const inverseCardinality = getInverseCardinality(relationshipType)

  // Determine inverse field's modelType and entityDefinitionId
  // relatedModelType is already lowercase, or use 'entity' for custom entities
  const inverseModelType = relatedModelType ?? 'entity'
  const inverseEntityDefinitionId = relatedEntityDefinitionId || null

  // Execute in transaction
  const result = await fromDatabase(
    database.transaction(async (tx) => {
      // Get positions for both sides
      const [primaryPosResult, inversePosResult] = await Promise.all([
        getHighestPosition(organizationId, dbModelType, entityDefinitionId),
        getHighestPosition(organizationId, inverseModelType, inverseEntityDefinitionId),
      ])

      const primaryPosition = (primaryPosResult[0]?.position ?? -1) + 1
      const inversePosition = (inversePosResult[0]?.position ?? -1) + 1

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
          position: primaryPosition,
          updatedAt: new Date(),
          options: {
            icon,
            isCustom: true,
            relationship: {
              // relatedModelType is already lowercase
              relatedModelType: relatedModelType ?? null,
              relatedEntityDefinitionId: relatedEntityDefinitionId || null,
              inverseFieldId: null,
              relationshipType,
              displayFieldId: displayFieldId || null,
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
      const inverseFieldResult = await tx
        .insert(schema.CustomField)
        .values({
          name: inverseName,
          type: 'RELATIONSHIP',
          description: inverseDescription,
          modelType: inverseModelType as any,
          entityDefinitionId: inverseEntityDefinitionId,
          organizationId,
          position: inversePosition,
          updatedAt: new Date(),
          options: {
            icon: inverseIcon,
            isCustom: true,
            relationship: {
              // modelType is already lowercase, use null for custom entities
              relatedModelType: modelType !== ModelTypes.ENTITY ? dbModelType : null,
              relatedEntityDefinitionId: modelType === ModelTypes.ENTITY ? entityDefinitionId : null,
              inverseFieldId: primaryField.id,
              relationshipType: inverseCardinality,
              displayFieldId: inverseDisplayFieldId || null,
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
