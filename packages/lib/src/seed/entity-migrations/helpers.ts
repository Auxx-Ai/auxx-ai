// packages/lib/src/seed/entity-migrations/helpers.ts

import { type Database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { and, eq } from 'drizzle-orm'
import {
  createDefaultFieldViewConfig,
  type ViewContextType,
} from '../../conditions/field-view-config'
import type { FieldOptions } from '../../custom-fields'
import type { ResourceField } from '../../resources/registry/field-types'
import { DISPLAY_FIELD_CONFIG, ENTITY_INSTANCE_COLUMNS } from '../entity-seeder/constants'
import type { SystemEntityConfig } from '../entity-seeder/types'
import { buildFieldOptions, mapCapabilities, shouldCreateField } from '../entity-seeder/utils'

const logger = createScopedLogger('entity-migrations:helpers')

// ─── Types ───────────────────────────────────────────────────────────

interface ExistingState {
  /** EntityDefinitions keyed by entityType */
  entityDefs: Map<string, { id: string; entityType: string }>
  /**
   * CustomFields keyed by `${entityDefinitionId}:${systemAttribute}`.
   * Scoped by entity definition because multiple entities may share a
   * systemAttribute (e.g. `external_id` on thread, contact, and company).
   * Use `fieldKey()` to construct lookup keys.
   */
  fields: Map<
    string,
    { id: string; systemAttribute: string; entityDefinitionId: string; options: FieldOptions }
  >
}

/**
 * Build the composite key used by `ExistingState.fields`.
 * Callers that know `(entityDefinitionId, systemAttribute)` should use
 * this rather than hand-rolling the template literal.
 */
export function fieldKey(entityDefinitionId: string, systemAttribute: string): string {
  return `${entityDefinitionId}:${systemAttribute}`
}

interface CreatedState {
  entityDefsCreated: number
  fieldsCreated: number
  relationshipsLinked: number
}

// ─── Load existing state ─────────────────────────────────────────────

/**
 * Load existing EntityDefinitions and CustomFields for an org.
 * Used by migrations to diff against what's expected.
 */
export async function loadExistingState(
  db: Database,
  organizationId: string
): Promise<ExistingState> {
  const [defs, fields] = await Promise.all([
    db
      .select({
        id: schema.EntityDefinition.id,
        entityType: schema.EntityDefinition.entityType,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, organizationId)),
    db
      .select({
        id: schema.CustomField.id,
        systemAttribute: schema.CustomField.systemAttribute,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
        options: schema.CustomField.options,
      })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, organizationId)),
  ])

  return {
    // Filter out custom entities (entityType is null for user-created entities)
    entityDefs: new Map(
      defs.filter((d) => d.entityType != null).map((d) => [d.entityType as string, d])
    ),
    fields: new Map(
      fields
        .filter(
          (f): f is typeof f & { systemAttribute: string; entityDefinitionId: string } =>
            f.systemAttribute != null && f.entityDefinitionId != null
        )
        .map((f) => [
          fieldKey(f.entityDefinitionId, f.systemAttribute),
          {
            id: f.id,
            systemAttribute: f.systemAttribute,
            entityDefinitionId: f.entityDefinitionId,
            options: f.options as FieldOptions,
          },
        ])
    ),
  }
}

// ─── Ensure EntityDefinitions ────────────────────────────────────────

/**
 * Create missing EntityDefinitions. Returns a map of entityType → id for all
 * entities (both existing and newly created).
 */
export async function ensureEntityDefinitions(
  db: Database,
  organizationId: string,
  entities: SystemEntityConfig[],
  existing: ExistingState,
  state: CreatedState
): Promise<Map<string, string>> {
  const entityDefIds = new Map<string, string>()
  const now = new Date()

  for (const entity of entities) {
    const existingDef = existing.entityDefs.get(entity.entityType)
    if (existingDef) {
      entityDefIds.set(entity.entityType, existingDef.id)
      continue
    }

    const [created] = await db
      .insert(schema.EntityDefinition)
      .values({
        organizationId,
        entityType: entity.entityType,
        apiSlug: entity.apiSlug,
        singular: entity.singular,
        plural: entity.plural,
        icon: entity.icon,
        color: entity.color,
        isVisible: entity.isVisible ?? true,
        updatedAt: now,
      })
      .returning()

    if (!created) throw new Error(`Failed to create EntityDefinition: ${entity.entityType}`)

    entityDefIds.set(entity.entityType, created.id)
    state.entityDefsCreated++
    logger.info(`Created EntityDefinition: ${entity.entityType}`, { id: created.id })
  }

  return entityDefIds
}

// ─── Ensure CustomFields ─────────────────────────────────────────────

/**
 * Create missing CustomFields for a set of field definitions.
 * Returns a fieldMap (entityType:fieldId → { id, systemAttribute, ... }) for relationship linking.
 */
export async function ensureCustomFields(
  db: Database,
  organizationId: string,
  entityType: string,
  entityDefId: string,
  fields: Record<string, ResourceField>,
  existing: ExistingState,
  state: CreatedState
): Promise<
  Map<
    string,
    { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
  >
> {
  const fieldMap = new Map<
    string,
    { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
  >()
  const now = new Date()

  for (const field of Object.values(fields)) {
    if (!shouldCreateField(field, ENTITY_INSTANCE_COLUMNS)) continue

    const key = `${entityType}:${field.id}`
    const existingField = existing.fields.get(fieldKey(entityDefId, field.systemAttribute!))

    if (existingField) {
      fieldMap.set(key, {
        id: existingField.id,
        systemAttribute: field.systemAttribute!,
        options: existingField.options as FieldOptions,
        _fieldDef: field,
      })
      continue
    }

    const capabilities = mapCapabilities(field.capabilities)
    const options = buildFieldOptions(field)

    const [created] = await db
      .insert(schema.CustomField)
      .values({
        organizationId,
        entityDefinitionId: entityDefId,
        modelType: entityType,
        name: field.label,
        type: field.fieldType!,
        description: field.description,
        systemAttribute: field.systemAttribute as SystemAttribute,
        sortOrder: field.systemSortOrder ?? 'a0',
        options,
        isCustom: false,
        updatedAt: now,
        ...capabilities,
      })
      .returning()

    if (!created) throw new Error(`Failed to create CustomField: ${key}`)

    fieldMap.set(key, {
      id: created.id,
      systemAttribute: field.systemAttribute!,
      options: created.options as FieldOptions,
      _fieldDef: field,
    })
    state.fieldsCreated++
    logger.debug(`Created CustomField: ${key}`, { id: created.id })
  }

  return fieldMap
}

// ─── Link relationships ──────────────────────────────────────────────

/**
 * Link relationship inverseResourceFieldId for newly created fields.
 * Safe to re-run — only updates if the current value is null.
 */
export async function linkNewRelationships(
  db: Database,
  allFieldMaps: Map<
    string,
    { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
  >,
  entityDefIds: Map<string, string>,
  state: CreatedState
): Promise<void> {
  const now = new Date()

  for (const [fieldKey, fieldRecord] of allFieldMaps.entries()) {
    const field = fieldRecord._fieldDef
    if (field.fieldType !== FieldTypeEnum.RELATIONSHIP) continue
    if (!field.relationship?.inverseResourceFieldId) continue

    // Check if already linked
    const currentRel = (fieldRecord.options as FieldOptions)?.relationship
    if (currentRel?.inverseResourceFieldId) continue

    const staticInverseRef = field.relationship.inverseResourceFieldId as string
    const [inverseEntityType] = staticInverseRef.split(':')

    // Skip special entity types (user)
    if (inverseEntityType === 'user') continue

    const inverseField = allFieldMaps.get(staticInverseRef)
    const inverseDefId = entityDefIds.get(inverseEntityType)
    if (!inverseField || !inverseDefId) {
      logger.debug(`Inverse not found for ${fieldKey} → ${staticInverseRef}, skipping`)
      continue
    }

    const resolvedInverseId = toResourceFieldId(inverseDefId, inverseField.id)

    await db
      .update(schema.CustomField)
      .set({
        options: {
          ...fieldRecord.options,
          relationship: {
            ...(fieldRecord.options as any)?.relationship,
            inverseResourceFieldId: resolvedInverseId,
          },
        },
        updatedAt: now,
      })
      .where(eq(schema.CustomField.id, fieldRecord.id))

    state.relationshipsLinked++
    logger.debug(`Linked relationship: ${fieldKey} → ${staticInverseRef}`)
  }
}

// ─── Link display fields ─────────────────────────────────────────────

/**
 * Link display fields for newly created EntityDefinitions.
 */
export async function linkDisplayFields(
  db: Database,
  entityTypes: string[],
  entityDefIds: Map<string, string>,
  allFieldMaps: Map<
    string,
    { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
  >
): Promise<void> {
  const now = new Date()

  for (const entityType of entityTypes) {
    const config = DISPLAY_FIELD_CONFIG[entityType]
    const defId = entityDefIds.get(entityType)
    if (!config || !defId) continue

    const primaryField = allFieldMaps.get(`${entityType}:${config.primaryDisplayField}`)
    const secondaryField = config.secondaryDisplayField
      ? allFieldMaps.get(`${entityType}:${config.secondaryDisplayField}`)
      : undefined
    const avatarField = config.avatarField
      ? allFieldMaps.get(`${entityType}:${config.avatarField}`)
      : undefined

    const updates: Record<string, unknown> = {}
    if (primaryField) updates.primaryDisplayFieldId = primaryField.id
    if (secondaryField) updates.secondaryDisplayFieldId = secondaryField.id
    if (avatarField) updates.avatarFieldId = avatarField.id

    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.EntityDefinition)
        .set({ ...updates, updatedAt: now })
        .where(eq(schema.EntityDefinition.id, defId))

      logger.debug(`Linked display fields for ${entityType}`)
    }
  }
}

// ─── Ensure Field Views ──────────────────────────────────────────────

interface FieldViewSeedConfig {
  entityType: string
  contextType: ViewContextType
  name: string
  includeFields?: string[]
  excludeFields?: string[]
}

/**
 * Create default field views (panel/dialog) for new entities.
 * Skips if a view already exists for the entity + context.
 */
export async function ensureFieldViews(
  db: Database,
  organizationId: string,
  userId: string,
  configs: FieldViewSeedConfig[],
  entityDefIds: Map<string, string>,
  allFieldMaps: Map<
    string,
    { id: string; systemAttribute: string; options: FieldOptions; _fieldDef: ResourceField }
  >
): Promise<void> {
  const now = new Date()

  for (const config of configs) {
    const { entityType, contextType, name, includeFields, excludeFields } = config
    const defId = entityDefIds.get(entityType)
    if (!defId) continue

    // Check if view already exists
    const existing = await db
      .select({ id: schema.TableView.id })
      .from(schema.TableView)
      .where(
        and(
          eq(schema.TableView.organizationId, organizationId),
          eq(schema.TableView.tableId, defId),
          eq(schema.TableView.contextType, contextType)
        )
      )
      .limit(1)

    if (existing.length > 0) continue

    // Build resourceFieldId list
    const excludeSet = new Set(excludeFields ?? [])
    const fieldIds: string[] = []

    if (includeFields?.length) {
      for (const systemAttr of includeFields) {
        const field = findFieldBySystemAttr(entityType, allFieldMaps, systemAttr)
        if (field) fieldIds.push(toResourceFieldId(defId, toFieldId(field.id)))
      }
    } else {
      for (const [key, field] of allFieldMaps.entries()) {
        if (!key.startsWith(`${entityType}:`)) continue
        if (excludeSet.has(field.systemAttribute)) continue
        fieldIds.push(toResourceFieldId(defId, toFieldId(field.id)))
      }
    }

    if (fieldIds.length === 0) continue

    const fieldViewConfig = createDefaultFieldViewConfig(fieldIds)

    // Mark excluded/non-included fields as hidden
    if (includeFields?.length) {
      const includedSet = new Set(fieldIds)
      for (const [key, field] of allFieldMaps.entries()) {
        if (!key.startsWith(`${entityType}:`)) continue
        const resourceFieldId = toResourceFieldId(defId, toFieldId(field.id))
        if (!includedSet.has(resourceFieldId)) {
          fieldViewConfig.fieldVisibility[resourceFieldId] = false
        }
      }
    } else if (excludeFields?.length) {
      for (const systemAttr of excludeFields) {
        const field = findFieldBySystemAttr(entityType, allFieldMaps, systemAttr)
        if (field) {
          const resourceFieldId = toResourceFieldId(defId, toFieldId(field.id))
          fieldViewConfig.fieldVisibility[resourceFieldId] = false
        }
      }
    }

    await db.insert(schema.TableView).values({
      organizationId,
      userId,
      tableId: defId,
      name,
      contextType,
      isDefault: true,
      isShared: true,
      config: fieldViewConfig,
      updatedAt: now,
    })

    logger.debug(`Created field view for ${entityType} ${contextType}`)
  }
}

function findFieldBySystemAttr(
  entityType: string,
  allFieldMaps: Map<string, { id: string; systemAttribute: string; options: any; _fieldDef: any }>,
  systemAttr: string
): { id: string } | undefined {
  for (const [key, field] of allFieldMaps.entries()) {
    if (!key.startsWith(`${entityType}:`)) continue
    if (field.systemAttribute === systemAttr) return field
  }
  return undefined
}
