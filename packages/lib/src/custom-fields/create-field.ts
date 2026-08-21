// packages/lib/src/custom-fields/create-field.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { fromDatabase } from '@auxx/services/shared/utils'
import {
  type ActorOptions,
  type AiOptions,
  type CalcOptions,
  canFieldBeUnique,
  isDisplayOptions,
  mergeDisplayOptions,
  type RelationshipConfig,
  type RelationshipOptions,
  type SelectOption,
  supportsDisplayOptions,
} from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { getModelType } from '@auxx/types/resource'
import { getInverseCardinality } from '@auxx/utils'
import { validateCalcExpression } from '@auxx/utils/calc-expression'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { type CustomFieldOptionsInput, type ModelType, ModelTypes } from './types'
import { validateAiOptions } from './validate-ai-options'

/**
 * Extract an `options.ai` block from the variant-shaped `options` payload.
 * Accepts any non-array object with an `ai` property; returns `undefined`
 * for arrays, primitives, or objects without `ai`.
 */
function pickAiOptions(options: unknown): AiOptions | undefined {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined
  const ai = (options as { ai?: unknown }).ai
  return ai as AiOptions | undefined
}

/**
 * Extract a SELECT/MULTI_SELECT option list from the variant-shaped
 * `options` payload. Accepts both the legacy `SelectOption[]` shape and
 * the `{ options: SelectOption[], ai?: AiOptions }` shape introduced for
 * AI-enabled selects.
 */
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
  /** Field options - select options, file config, flat display options
   *  (incl. CURRENCY), actor/calc bags, or `{ options, ai }` for AI-enabled selects. */
  options?: CustomFieldOptionsInput
  addressComponents?: string[]
  /** ADDRESS_STRUCT input variant: single free-text input (default, omitted
   *  from storage) vs. separate structured sub-fields. */
  inputMode?: 'single' | 'structured'
  icon?: string
  isCustom?: boolean
  entityDefinitionId?: string | null
  /** Relationship-specific options (required when type is RELATIONSHIP) */
  relationship?: RelationshipOptions
  /** Whether this field must contain unique values within its scope */
  isUnique?: boolean
  /** System attribute identifier (e.g., 'full_name', 'primary_email') */
  systemAttribute?: string
  /** Whether this field can be set during entity creation (default: true) */
  isCreatable?: boolean
  /** Whether this field can be modified after creation (default: true) */
  isUpdatable?: boolean
  /** Whether this field is computed/derived (default: false) */
  isComputed?: boolean
  /** Whether this field can be used for sorting (default: true) */
  isSortable?: boolean
  /** Whether this field can be used in filters (default: true) */
  isFilterable?: boolean
  /** Hidden from every user-facing surface; system/app code still reads it. Default false. */
  isHidden?: boolean
  /** When false, hidden from the default create/update dialogs unless an org view
   *  explicitly enables it. Persisted at the top level of `options`. Default undefined
   *  (shown). See `ResourceField.showInDialogs`. */
  showInDialogs?: boolean

  // --- App ownership (app-registered custom fields) ---
  /** Owning app installation. Set => app-owned: user-read-only, removed on uninstall. */
  appInstallationId?: string
  /** Owning connection (Credential.id / credId) for scope:'connection' fields. */
  connectionId?: string
  /** App-stable field key for idempotent provisioning + reverse lookup (e.g. 'customerId'). */
  appFieldKey?: string
  /** Owning data connector. Set => connector-provisioned (owned-mode schema). */
  dataConnectorId?: string
  /** Declared `identity: true` in the app's `defineFields` — an external-system
   *  id, not a plain attribute. Drives the sink write-ownership rule + the
   *  `RecordIdentity` mirror. Default false. */
  isIdentity?: boolean
  /** App slug (e.g. 'shopify') for app-owned fields — the `RecordIdentity.source`
   *  value, supplied without joining AppInstallation. */
  appSlug?: string
}

/**
 * Walk a DESC-ordered sortOrder window and return the first entry that
 * `generateKeyBetween` accepts. Legacy system-field seeds shipped with
 * malformed fractional-indexing keys (e.g. 'z9', 'b0'); skipping them
 * keeps field creation unblocked on orgs that still have them in the DB.
 */
function pickValidAnchor(rows: Array<{ sortOrder: string | null }>): string | null {
  for (const row of rows) {
    if (!row.sortOrder) continue
    try {
      generateKeyBetween(row.sortOrder, null)
      return row.sortOrder
    } catch {
      // Malformed — try the next one.
    }
  }
  return null
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

  // Pull a window of candidates (not just one) so the caller can skip past
  // legacy malformed keys without issuing more queries.
  return db
    .select({ sortOrder: schema.CustomField.sortOrder })
    .from(schema.CustomField)
    .where(and(...conditions))
    .orderBy(desc(schema.CustomField.sortOrder))
    .limit(20)
}

/**
 * Resolve a non-colliding field name on a target def, appending " 2", " 3", … until
 * free — mirroring the slug-dedupe in the entity-template installer.
 *
 * Used for the AUTO-CREATED inverse of a relationship field: unlike the forward field
 * (whose name the caller pre-checks → `DUPLICATE_FIELD_NAME`), the inverse name is the
 * caller's `inverseName`, which can clash with a field already on the related def (a
 * pre-existing "Orders" relationship on Contact, an orphaned inverse from a deleted
 * connector, …). It carries no `appFieldKey` to dedupe by and shares the user/system
 * namespace (`appInstallationId IS NULL` — the `CustomField_name_org_model_entity_key`
 * partial unique index), so a raw insert would unique-violate and abort the whole
 * transaction. Deduping keeps the relationship instead of crashing the caller.
 */
async function resolveUniqueFieldName(
  db: Database | Transaction,
  organizationId: string,
  modelType: string,
  entityDefinitionId: string,
  desiredName: string
): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? desiredName : `${desiredName} ${attempt}`
    const existing = await db.query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.name, candidate),
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.modelType, modelType as any),
        eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
        isNull(schema.CustomField.appInstallationId)
      ),
      columns: { id: true },
    })
    if (!existing) return candidate
  }
  throw new Error(`Cannot find an available field name for "${desiredName}"`)
}

/**
 * Create a new custom field
 * For RELATIONSHIP type, automatically creates the inverse field
 *
 * @param input - Field data
 * @param tx - Optional database or transaction context (defaults to global database).
 *             Every helper this hands it to already takes `Database | Transaction`, and
 *             the relationship path opens its own transaction when handed the global
 *             database — so a plain `Database` has always been valid here.
 * @returns Result with created field (or primary field for relationships)
 */
export async function createCustomField(
  input: CreateCustomFieldInput,
  tx?: Database | Transaction
) {
  const {
    organizationId,
    name,
    type,
    description,
    required,
    defaultValue,
    options,
    addressComponents,
    inputMode,
    icon,
    isCustom = true,
    entityDefinitionId,
    relationship,
    isUnique = false,
    systemAttribute,
    isCreatable,
    isUpdatable,
    isComputed,
    isSortable,
    isFilterable,
    isHidden,
    appInstallationId,
    connectionId,
    appFieldKey,
    dataConnectorId,
    isIdentity,
    appSlug,
    showInDialogs,
  } = input

  // Use provided transaction or default to global database
  const db = tx ?? database

  // Derive modelType from entityDefinitionId
  const modelType = entityDefinitionId ? getModelType(entityDefinitionId) : ModelTypes.CONTACT
  const dbModelType = modelType

  // Check for an existing field. App-owned fields are a separate namespace:
  // they dedupe by (appInstallationId, connectionId?, appFieldKey) and may
  // share a display name with a user field. User/system fields dedupe by
  // display name and must ignore app rows (the partial unique indexes mirror
  // this split — see custom-field.ts).
  const duplicateConditions = appInstallationId
    ? [
        eq(schema.CustomField.appInstallationId, appInstallationId),
        eq(schema.CustomField.appFieldKey, appFieldKey ?? ''),
        connectionId
          ? eq(schema.CustomField.connectionId, connectionId)
          : isNull(schema.CustomField.connectionId),
      ]
    : [
        eq(schema.CustomField.name, name),
        eq(schema.CustomField.organizationId, organizationId),
        isNull(schema.CustomField.appInstallationId),
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
    return err(
      appInstallationId
        ? {
            code: 'DUPLICATE_FIELD_NAME' as const,
            message: `App field "${appFieldKey}" already exists for this installation`,
          }
        : {
            code: 'DUPLICATE_FIELD_NAME' as const,
            message: `A field named "${name}" already exists`,
          }
    )
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
        // Connector/app ownership: the FORWARD field is the idempotency anchor, so
        // it carries `appFieldKey` + the ownership FKs + read-only capability flags;
        // the inverse rides along (stamped with the FKs only, never the app key).
        appFieldKey,
        appInstallationId,
        connectionId,
        dataConnectorId,
        isCreatable,
        isUpdatable,
        isHidden,
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

  // Validate AI options block (if present). Runs before options are built
  // so we can reject an invalid payload without persisting anything.
  const aiOptions = pickAiOptions(options)
  const aiValidation = await validateAiOptions({
    organizationId,
    type,
    ai: aiOptions,
    selectOptions: pickSelectOptions(options),
  })
  if (aiValidation.isErr()) {
    return aiValidation
  }

  // Build field options for non-relationship types
  const fieldOptions: Record<string, any> = {
    icon,
    isCustom,
    ...(showInDialogs !== undefined && { showInDialogs }),
  }

  if (
    type === FieldTypeEnum.SINGLE_SELECT ||
    type === FieldTypeEnum.MULTI_SELECT ||
    type === FieldTypeEnum.TAGS
  ) {
    const selectOpts = pickSelectOptions(options)
    if (selectOpts) {
      fieldOptions.options = selectOpts
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
    // Only persist the key for the non-default 'structured' mode — absence
    // means 'single' (decision #4, plans/address-field/01-single-input-address-field.md).
    if (inputMode === 'structured') {
      fieldOptions.inputMode = 'structured'
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

  // Persist options.ai when present on an AI-eligible type (already
  // validated above; non-eligible types reject before this point).
  if (aiOptions) {
    fieldOptions.ai = aiOptions
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

  const newSortOrder = generateKeyBetween(pickValidAnchor(lastFieldResult.value), null)

  // Determine capability flags based on field type and explicit inputs
  // CALC fields are computed and should not be manually creatable or updatable
  // Explicit isCreatable/isUpdatable values override defaults
  const isCalcField = type === FieldTypeEnum.CALC
  const capabilityFlags = {
    ...(isCalcField && { isComputed: true }),
    ...(isCreatable !== undefined && { isCreatable }),
    ...(isUpdatable !== undefined && { isUpdatable }),
    ...(isComputed !== undefined && { isComputed }),
    ...(isSortable !== undefined && { isSortable }),
    ...(isFilterable !== undefined && { isFilterable }),
    ...(isHidden !== undefined && { isHidden }),
    ...(isCalcField && isCreatable === undefined && { isCreatable: false }),
    ...(isCalcField && isUpdatable === undefined && { isUpdatable: false }),
  }

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
        appInstallationId: appInstallationId ?? null,
        connectionId: connectionId ?? null,
        appFieldKey: appFieldKey ?? null,
        dataConnectorId: dataConnectorId ?? null,
        isIdentity: isIdentity ?? false,
        appSlug: appSlug ?? null,
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
    /** App/connector ownership — stamped on the FORWARD field only (idempotency anchor). */
    appFieldKey?: string
    appInstallationId?: string
    connectionId?: string
    /** Stamped on BOTH forward + inverse so a `dataConnectorId`-keyed cleanup sweep removes both. */
    dataConnectorId?: string
    isCreatable?: boolean
    isUpdatable?: boolean
    isHidden?: boolean
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
    appFieldKey,
    appInstallationId,
    connectionId,
    dataConnectorId,
    isCreatable,
    isUpdatable,
    isHidden,
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

    const primarySortOrder = generateKeyBetween(pickValidAnchor(primarySortResult), null)
    const inverseSortOrder = generateKeyBetween(pickValidAnchor(inverseSortResult), null)

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
        // App/connector ownership — FORWARD field is the idempotency anchor.
        appInstallationId: appInstallationId ?? null,
        connectionId: connectionId ?? null,
        appFieldKey: appFieldKey ?? null,
        dataConnectorId: dataConnectorId ?? null,
        ...(isCreatable !== undefined && { isCreatable }),
        ...(isUpdatable !== undefined && { isUpdatable }),
        ...(isHidden !== undefined && { isHidden }),
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

    // Dedupe the inverse name if the target def already owns a field by that name
    // (pre-existing relationship, orphaned inverse, …). The forward field is the only
    // idempotency anchor; the inverse must never unique-violate and roll back the txn.
    const resolvedInverseName = await resolveUniqueFieldName(
      tx,
      organizationId,
      inverseModelType,
      inverseEntityDefinitionId,
      inverseName
    )

    const inverseFieldResult = await tx
      .insert(schema.CustomField)
      .values({
        name: resolvedInverseName,
        type: 'RELATIONSHIP',
        description: inverseDescription,
        modelType: inverseModelType as any,
        entityDefinitionId: inverseEntityDefinitionId,
        organizationId,
        sortOrder: inverseSortOrder,
        systemAttribute: inverseSystemAttribute,
        // Connector ownership FK only (NO appFieldKey — the inverse is never looked up
        // for provisioning, only cascaded); lets the `dataConnectorId` sweep remove it.
        dataConnectorId: dataConnectorId ?? null,
        // The inverse mirrors the forward's user-read-only capability for connector edges.
        ...(isCreatable !== undefined && { isCreatable }),
        ...(isUpdatable !== undefined && { isUpdatable }),
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
      : performOperation(db as Transaction), // Use existing transaction
    'create-relationship-field'
  )

  // Return primary field for consistency with regular createCustomField
  if (result.isOk()) {
    return ok(result.value.primaryField)
  }
  return result
}
