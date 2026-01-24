// packages/services/src/custom-fields/create-field.ts

import { database, schema, type Database, type Transaction } from '@auxx/database'
import { eq, and, desc } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { getInverseCardinality } from '@auxx/utils'
import { getModelType } from '@auxx/types/resource'
import { toResourceFieldId } from '@auxx/types/field'
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
import { validateCalcExpression } from '@auxx/utils/calc-expression'
import type { CalcOptions } from '@auxx/lib/custom-fields/field-options'
import type { ActorOptions } from '@auxx/types/custom-field'
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
  entityDefinitionId?: string | null
  /** Relationship-specific options (required when type is RELATIONSHIP) */
  relationship?: RelationshipOptions
  /** Whether this field must contain unique values within its scope */
  isUnique?: boolean
  /** System attribute identifier (e.g., 'full_name', 'primary_email') */
  systemAttribute?: string
}

/**
 * Get the last field by sortOrder for a scope.
 * If entityDefinitionId is provided, filter by that (works for both system and custom entities).
 * Otherwise, fall back to filtering by modelType.
 */
async function getLastFieldSortOrder(
  organizationId: string,
  modelType: string,
  entityDefinitionId?: string | null,
  db: Database | Transaction = database
) {
  const conditions = [eq(schema.CustomField.organizationId, organizationId)]

  // Prefer entityDefinitionId if available, otherwise use modelType
  if (entityDefinitionId) {
    conditions.push(eq(schema.CustomField.entityDefinitionId, entityDefinitionId))
  } else {
    conditions.push(eq(schema.CustomField.modelType, modelType as any))
  }

  return db
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
 * @param tx - Optional transaction context (defaults to global database)
 * @returns Result with created field (or primary field for relationships)
 */
export async function createCustomField(input: CreateCustomFieldInput, tx?: Transaction) {
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
    entityDefinitionId,
    relationship,
    isUnique = false,
    systemAttribute,
  } = input

  // Use provided transaction or default to global database
  const db = tx ?? database

  // Derive modelType from entityDefinitionId
  const modelType = entityDefinitionId ? getModelType(entityDefinitionId) : ModelTypes.CONTACT
  const dbModelType = modelType

  // Check for existing field with same name
  // Prefer entityDefinitionId if available, otherwise use modelType
  const duplicateConditions = [
    eq(schema.CustomField.name, name),
    eq(schema.CustomField.organizationId, organizationId),
  ]
  if (entityDefinitionId) {
    duplicateConditions.push(eq(schema.CustomField.entityDefinitionId, entityDefinitionId))
  } else {
    duplicateConditions.push(eq(schema.CustomField.modelType, dbModelType as any))
  }
  const existingField = await db.query.CustomField.findFirst({
    where: and(...duplicateConditions),
  })

  if (existingField) {
    return err({
      code: 'DUPLICATE_FIELD_NAME' as const,
      message: `A field named "${name}" already exists`,
    })
  }

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
    return createRelationshipFieldWithInverse(
      {
        organizationId,
        name,
        description,
        icon,
        modelType,
        entityDefinitionId,
        relationship,
        systemAttribute,
      },
      db
    )
  }

  // Handle CALC type validation
  if (type === FieldTypeEnum.CALC) {
    const calcOptions =
      options && !Array.isArray(options) && 'calc' in options
        ? (options as { calc: CalcOptions }).calc
        : undefined

    if (!calcOptions?.expression) {
      return err({
        code: 'VALIDATION_ERROR' as const,
        message: 'CALC field requires an expression',
      })
    }

    // Validate expression syntax
    const validation = validateCalcExpression(calcOptions.expression)
    if (!validation.isValid) {
      return err({
        code: 'VALIDATION_ERROR' as const,
        message: `Invalid expression: ${validation.error}`,
      })
    }

    // Source fields are now stored as ResourceFieldId format (entityDefinitionId:fieldId)
    // and can reference fields from related entities via relationships.
    // We trust the frontend field picker to select valid fields.
  }

  // Handle ACTOR type validation
  if (type === FieldTypeEnum.ACTOR) {
    if (options && !Array.isArray(options) && 'actor' in options) {
      const actorOpts = (options as { actor: ActorOptions }).actor

      // Validate required fields
      if (!actorOpts.target) {
        return err({
          code: 'VALIDATION_ERROR' as const,
          message: 'ACTOR field requires a target type (user, group, or both)',
        })
      }
      if (typeof actorOpts.multiple !== 'boolean') {
        return err({
          code: 'VALIDATION_ERROR' as const,
          message: 'ACTOR field requires multiple: boolean',
        })
      }

      // Validate roles if provided
      if (actorOpts.roles?.length) {
        const validRoles = ['OWNER', 'ADMIN', 'USER']
        for (const role of actorOpts.roles) {
          if (!validRoles.includes(role)) {
            return err({
              code: 'VALIDATION_ERROR' as const,
              message: `Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`,
            })
          }
        }
      }
    } else {
      return err({
        code: 'VALIDATION_ERROR' as const,
        message: 'ACTOR field requires options.actor configuration',
      })
    }
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

  // Handle CALC field options
  if (type === FieldTypeEnum.CALC) {
    if (options && !Array.isArray(options) && 'calc' in options) {
      fieldOptions.calc = (options as { calc: CalcOptions }).calc
    }
  }

  // Handle ACTOR field options
  if (type === FieldTypeEnum.ACTOR) {
    if (options && !Array.isArray(options) && 'actor' in options) {
      fieldOptions.actor = (options as { actor: ActorOptions }).actor
    }
  }

  // Handle flat display options for CHECKBOX, NUMBER, DATE, DATETIME, TIME, PHONE_INTL
  if (supportsDisplayOptions(type) && options && isDisplayOptions(options)) {
    Object.assign(fieldOptions, mergeDisplayOptions(type, options, {}))
  }

  // Get last field's sortOrder using provided db context
  const lastFieldResult = await fromDatabase(
    getLastFieldSortOrder(organizationId, dbModelType, entityDefinitionId, db),
    'get-last-field-sort-order'
  )
  // console.log('Last field result:', lastFieldResult)

  if (lastFieldResult.isErr()) {
    return lastFieldResult
  }

  const lastSortOrder = lastFieldResult.value[0]?.sortOrder ?? null
  const newSortOrder = generateKeyBetween(lastSortOrder, null)

  // Determine capability flags based on field type
  // CALC fields are computed and should not be manually creatable or updatable
  const isCalcField = type === FieldTypeEnum.CALC
  const capabilityFlags = isCalcField
    ? { isCreatable: false, isUpdatable: false, isComputed: true }
    : {}

  // Insert field using provided db context
  const insertResult = await fromDatabase(
    db
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
        systemAttribute,
        updatedAt: new Date(),
        ...capabilityFlags,
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
async function createRelationshipFieldWithInverse(
  input: {
    organizationId: string
    name: string
    description?: string
    icon?: string
    modelType: ModelType
    entityDefinitionId?: string | null
    relationship?: RelationshipOptions
    systemAttribute?: string
  },
  db: Database | Transaction = database
) {
  const {
    organizationId,
    name,
    description,
    icon,
    modelType,
    entityDefinitionId,
    relationship,
    systemAttribute,
  } = input

  console.log('Creating relationship field:', input)

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
    inverseSystemAttribute,
  } = relationship

  // relatedResourceId should be an EntityDefinition.id (UUID)
  // Everything has an entityDefinitionId now (system and custom entities)
  const relatedEntityDefinitionId = relatedResourceId

  if (!relatedEntityDefinitionId) {
    return err({
      code: 'VALIDATION_ERROR' as const,
      message: 'relatedResourceId must be specified for relationship fields',
    })
  }

  // modelType is already lowercase and matches DB format directly
  const dbModelType = modelType
  const inverseCardinality = getInverseCardinality(relationshipType)

  // Define the operation that creates both relationship fields
  const performOperation = async (tx: Transaction) => {
    // Query the related EntityDefinition to get its modelType
    const relatedDef = await tx.query.EntityDefinition.findFirst({
      where: eq(schema.EntityDefinition.id, relatedEntityDefinitionId),
    })

    if (!relatedDef) {
      throw new Error(`Related EntityDefinition not found for ID: ${relatedEntityDefinitionId}`)
    }

    // Inverse field uses the related entity's modelType and entityDefinitionId
    // Use getModelType to properly derive modelType from entityDefinitionId
    // (for system entities it returns 'contact'/'ticket'/etc, for custom entities it returns 'entity')
    const inverseModelType = getModelType(relatedEntityDefinitionId)
    const inverseEntityDefinitionId = relatedEntityDefinitionId

    // Get sortOrder for both sides using tx
    const [primarySortResult, inverseSortResult] = await Promise.all([
      getLastFieldSortOrder(organizationId, dbModelType, entityDefinitionId, tx),
      getLastFieldSortOrder(organizationId, inverseModelType, inverseEntityDefinitionId, tx),
    ])

    const primarySortOrder = generateKeyBetween(primarySortResult[0]?.sortOrder ?? null, null)
    const inverseSortOrder = generateKeyBetween(inverseSortResult[0]?.sortOrder ?? null, null)

    // Create primary field using tx
    // Initially set inverseResourceFieldId to null - will be updated after inverse field creation
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
        systemAttribute,
        updatedAt: new Date(),
        options: {
          icon,
          isCustom: true,
          relationship: {
            inverseResourceFieldId: null,
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

    // Create inverse field using tx
    // Inverse field's inverseResourceFieldId points back to the primary field
    const inverseRelatedEntityDefinitionId = entityDefinitionId!

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
        systemAttribute: inverseSystemAttribute,
        updatedAt: new Date(),
        options: {
          icon: inverseIcon,
          isCustom: true,
          relationship: {
            inverseResourceFieldId: toResourceFieldId(
              inverseRelatedEntityDefinitionId,
              primaryField.id
            ),
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

    // Update primary field with inverseResourceFieldId using tx
    const primaryOptions = primaryField.options as { relationship: RelationshipConfig }
    const updatedPrimaryFieldResult = await tx
      .update(schema.CustomField)
      .set({
        options: {
          ...primaryOptions,
          relationship: {
            ...primaryOptions.relationship,
            inverseResourceFieldId: toResourceFieldId(relatedEntityDefinitionId, inverseField.id),
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
  }

  // Execute with or without transaction wrapper
  // If db is the global database, create a new transaction
  // If db is already a transaction context (passed from seeder), use it directly
  const result = await fromDatabase(
    db === database
      ? database.transaction(performOperation) // Create new transaction
      : performOperation(db), // Use existing transaction
    'create-relationship-field'
  )

  // Return primary field for consistency with regular createCustomField
  if (result.isOk()) {
    return ok(result.value.primaryField)
  }
  return result
}
