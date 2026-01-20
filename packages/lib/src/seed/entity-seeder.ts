// packages/lib/src/seed/entity-seeder.ts

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { RESOURCE_TABLE_MAP } from '../resources/registry'
import { CONTACT_FIELDS } from '../resources/registry/resources/contact-fields'
import { TICKET_FIELDS } from '../resources/registry/resources/ticket-fields'
import { PART_FIELDS } from '../resources/registry/resources/part-fields'
import type { ResourceField } from '../resources/registry/field-types'
import { FieldType } from '@auxx/database/enums'
import { createCustomField } from '@auxx/services/custom-fields'
import type { CreateCustomFieldInput } from '@auxx/services/custom-fields'
import { ModelTypes, type ModelType } from '@auxx/services/custom-fields'
import { DEFAULT_VIEW_CONFIGS } from './default-view-configs'
import { toResourceFieldId, toFieldId } from '@auxx/types/field'

const logger = createScopedLogger('entity-seeder')

/**
 * System entity definitions from registry
 * Maps entity type to field definitions
 */
const SYSTEM_ENTITY_REGISTRY = {
  contact: {
    meta: RESOURCE_TABLE_MAP['contact'],
    fields: CONTACT_FIELDS,
    primaryDisplayField: 'full_name',
    secondaryDisplayField: 'primary_email',
  },
  ticket: {
    meta: RESOURCE_TABLE_MAP['ticket'],
    fields: TICKET_FIELDS,
    primaryDisplayField: 'ticket_title',
    secondaryDisplayField: 'ticket_number',
  },
  part: {
    meta: RESOURCE_TABLE_MAP['part'],
    fields: PART_FIELDS,
    primaryDisplayField: 'part_title',
    secondaryDisplayField: 'part_sku',
  },
} as const

/**
 * Fields that are EntityInstance columns, not CustomFields
 * These should NOT be seeded as CustomFields
 */
const ENTITY_INSTANCE_FIELDS = ['id', 'created_at', 'updated_at'] as const

/**
 * Transform ResourceField to CreateCustomFieldInput for service layer
 * Handles regular fields - relationship fields handled separately
 */
function transformToCustomFieldInput(
  field: ResourceField,
  organizationId: string,
  modelType: ModelType,
  entityDefinitionId?: string
): CreateCustomFieldInput | null {
  // Skip EntityInstance fields
  if (!field.systemAttribute || ENTITY_INSTANCE_FIELDS.includes(field.systemAttribute as any)) {
    return null
  }

  // Skip relationships - handled separately
  if (field.fieldType === FieldType.RELATIONSHIP) {
    return null
  }

  return {
    organizationId,
    modelType,
    entityDefinitionId: entityDefinitionId || null,
    name: field.label,
    type: field.fieldType!,
    description: field.description,
    required: field.capabilities?.required ?? false,
    isUnique: field.capabilities?.unique ?? false,
    isCustom: false, // System fields
    options: field.options ?? undefined,
    icon: field.icon,
    systemAttribute: field.systemAttribute,
  }
}

/**
 * Transform relationship ResourceField to CreateCustomFieldInput
 * Note: This creates a partial input - the actual relatedResourceId lookup
 * happens during seeding when we have transaction context
 */
function transformRelationshipToInput(
  field: ResourceField,
  organizationId: string,
  modelType: ModelType,
  entityDefinitionId?: string,
  relatedEntityDefinitionId?: string
): CreateCustomFieldInput | null {
  if (!field.relationshipConfig) {
    return null
  }

  return {
    organizationId,
    modelType,
    entityDefinitionId: entityDefinitionId || null,
    name: field.label,
    type: FieldType.RELATIONSHIP,
    description: field.description,
    required: field.capabilities?.required ?? false,
    isCustom: false,
    icon: field.icon,
    systemAttribute: field.systemAttribute,
    relationship: {
      relatedResourceId: relatedEntityDefinitionId || field.relationshipConfig.relatedEntityType,
      relationshipType: field.relationshipConfig.relationshipType,
      inverseName: field.relationshipConfig.inverseName,
      inverseDescription: `Inverse of ${field.label}`,
      inverseIcon: '',
      inverseSystemAttribute: field.relationshipConfig.inverseSystemAttribute,
    },
  }
}

/**
 * EntitySeeder seeds system EntityDefinitions and CustomFields
 * Uses registry as the single source of truth
 */
export class EntitySeeder {
  constructor(
    private db: Database,
    private organizationId: string
  ) {}

  /**
   * Seed all system entities (Contact, Ticket, Part, EntityGroup)
   * Transforms from registry instead of hardcoded data
   */
  async seedSystemEntities(): Promise<void> {
    logger.info('Seeding system entities', { organizationId: this.organizationId })

    for (const [entityType, config] of Object.entries(SYSTEM_ENTITY_REGISTRY)) {
      await this.seedEntity(entityType as keyof typeof SYSTEM_ENTITY_REGISTRY, config)
    }

    // Seed entity_group definition (doesn't have custom fields - uses metadata)
    await this.seedEntityGroupDefinition()

    logger.info('Successfully seeded system entities', { organizationId: this.organizationId })
  }

  /**
   * Seed the entity_group EntityDefinition
   * EntityGroups use metadata for properties instead of custom fields
   */
  private async seedEntityGroupDefinition(): Promise<void> {
    const now = new Date()

    // Check if already exists
    const existing = await this.db.query.EntityDefinition.findFirst({
      where: and(
        eq(schema.EntityDefinition.entityType, 'entity_group'),
        eq(schema.EntityDefinition.organizationId, this.organizationId)
      ),
    })

    if (existing) {
      logger.info('EntityGroup definition already exists, skipping', {
        organizationId: this.organizationId,
        entityDefinitionId: existing.id,
      })
      return
    }

    // Create entity_group EntityDefinition
    const [createdDef] = await this.db
      .insert(schema.EntityDefinition)
      .values({
        organizationId: this.organizationId,
        entityType: 'entity_group',
        apiSlug: 'entity-groups',
        singular: 'Group',
        plural: 'Groups',
        icon: 'users',
        color: 'purple',
        updatedAt: now.toISOString(),
      })
      .returning()

    if (!createdDef) {
      throw new Error('Failed to create EntityDefinition for entity_group')
    }

    logger.info('Created EntityDefinition: entity_group', {
      organizationId: this.organizationId,
      entityDefinitionId: createdDef.id,
    })
  }

  /**
   * Seed a single system entity from registry
   */
  private async seedEntity(
    entityType: keyof typeof SYSTEM_ENTITY_REGISTRY,
    config: (typeof SYSTEM_ENTITY_REGISTRY)[keyof typeof SYSTEM_ENTITY_REGISTRY]
  ): Promise<void> {
    const now = new Date()

    // Wrap everything in a transaction for atomicity
    await this.db.transaction(async (tx) => {
      // Create EntityDefinition
      const [createdDef] = await tx
        .insert(schema.EntityDefinition)
        .values({
          organizationId: this.organizationId,
          entityType,
          apiSlug: config.meta.apiSlug,
          singular: config.meta.label,
          plural: config.meta.plural,
          icon: config.meta.icon,
          color: config.meta.color,
          updatedAt: now.toISOString(),
        })
        .returning()

      if (!createdDef) {
        throw new Error(`Failed to create EntityDefinition for ${entityType}`)
      }

      logger.info(`Created EntityDefinition: ${entityType}`, {
        organizationId: this.organizationId,
        entityDefinitionId: createdDef.id,
      })

      // Determine modelType for field creation
      // For system entities, modelType = entityType (e.g., 'contact', 'ticket')
      const modelType = entityType as ModelType

      // Separate regular fields from relationship fields
      const allFields = Object.values(config.fields)
      const regularFields = allFields.filter((f) => f.fieldType !== FieldType.RELATIONSHIP)
      const relationshipFields = allFields.filter((f) => f.fieldType === FieldType.RELATIONSHIP)

      // Create regular fields using createCustomField
      // CRITICAL: Pass tx context to createCustomField for atomicity
      for (const field of regularFields) {
        const input = transformToCustomFieldInput(
          field,
          this.organizationId,
          modelType,
          createdDef.id
        )

        if (!input) continue

        const result = await createCustomField(input, tx)

        if (result.isErr()) {
          logger.error(`Failed to create field ${field.label}`, {
            error: result.error,
            entityType,
          })
          throw new Error(`Failed to create field ${field.label}: ${result.error.message}`)
        }

        logger.debug(`Created field: ${field.label}`)
      }

      logger.info(`Created ${regularFields.length} regular fields for ${entityType}`)

      // Create relationship fields using createCustomField
      // This automatically creates BOTH primary and inverse fields
      // CRITICAL: Pass tx context to createCustomField for atomicity
      for (const field of relationshipFields) {
        if (!field.relationshipConfig) {
          logger.warn(`Skipping relationship field without config: ${field.label}`)
          continue
        }

        // Look up the related entity's EntityDefinition ID
        const relatedEntityType = field.relationshipConfig.relatedEntityType
        const relatedEntityDef = await tx.query.EntityDefinition.findFirst({
          where: eq(schema.EntityDefinition.entityType, relatedEntityType),
        })

        if (!relatedEntityDef) {
          logger.warn(
            `Skipping relationship field ${field.label}: related entity ${relatedEntityType} not found`
          )
          continue
        }

        const input = transformRelationshipToInput(
          field,
          this.organizationId,
          modelType,
          createdDef.id,
          relatedEntityDef.id
        )

        if (!input) {
          logger.warn(`Skipping relationship field without config: ${field.label}`)
          continue
        }

        const result = await createCustomField(input, tx)

        if (result.isErr()) {
          logger.error(`Failed to create relationship field ${field.label}`, {
            error: result.error,
            entityType,
          })
          throw new Error(
            `Failed to create relationship field ${field.label}: ${result.error.message}`
          )
        }

        logger.debug(`Created relationship field pair: ${field.label}`)
      }

      logger.info(`Created ${relationshipFields.length} relationship field pairs for ${entityType}`)

      // Link display fields (keep existing logic)
      const fieldsToLink: {
        primaryDisplayFieldId?: string
        secondaryDisplayFieldId?: string
      } = {}

      if (config.primaryDisplayField) {
        const primaryField = await tx.query.CustomField.findFirst({
          where: and(
            eq(schema.CustomField.entityDefinitionId, createdDef.id),
            eq(schema.CustomField.systemAttribute, config.primaryDisplayField)
          ),
        })
        if (primaryField) {
          fieldsToLink.primaryDisplayFieldId = primaryField.id
        }
      }

      if (config.secondaryDisplayField) {
        const secondaryField = await tx.query.CustomField.findFirst({
          where: and(
            eq(schema.CustomField.entityDefinitionId, createdDef.id),
            eq(schema.CustomField.systemAttribute, config.secondaryDisplayField)
          ),
        })
        if (secondaryField) {
          fieldsToLink.secondaryDisplayFieldId = secondaryField.id
        }
      }

      // Update EntityDefinition with display field IDs
      if (Object.keys(fieldsToLink).length > 0) {
        await tx
          .update(schema.EntityDefinition)
          .set(fieldsToLink)
          .where(eq(schema.EntityDefinition.id, createdDef.id))

        logger.info(`Linked display fields for ${entityType}`, {
          organizationId: this.organizationId,
          entityDefinitionId: createdDef.id,
          ...fieldsToLink,
        })
      }

      // Create default table view
      const tableId = `entity-${createdDef.id}`
      await this.createDefaultView(tx, entityType, createdDef.id, tableId)
    }) // End transaction
  }

  /**
   * Create default table view for a system entity
   */
  private async createDefaultView(
    tx: Database,
    entityType: keyof typeof SYSTEM_ENTITY_REGISTRY,
    entityDefinitionId: string,
    tableId: string
  ): Promise<void> {
    const viewConfig = DEFAULT_VIEW_CONFIGS[entityType]

    if (!viewConfig) {
      logger.warn(`No default view config found for ${entityType}`)
      return
    }

    // Resolve field IDs from systemAttributes
    const customFields = await tx.query.CustomField.findMany({
      where: eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
    })

    // Build field mapping: systemAttribute -> customFieldId
    const fieldIdMap = new Map<string, string>()
    for (const field of customFields) {
      if (field.systemAttribute) {
        fieldIdMap.set(`field_${field.systemAttribute}`, field.id)
      }
    }

    // Transform column visibility to use ResourceFieldId format
    const resolvedColumnVisibility: Record<string, boolean> = {}
    for (const [columnId, visible] of Object.entries(viewConfig.config.columnVisibility)) {
      const actualFieldId = fieldIdMap.get(columnId)
      if (actualFieldId) {
        const resourceFieldId = toResourceFieldId(entityDefinitionId, toFieldId(actualFieldId))
        resolvedColumnVisibility[resourceFieldId] = visible
      }
    }

    // Transform column order to use ResourceFieldId format
    const resolvedColumnOrder: string[] = []
    for (const columnId of viewConfig.config.columnOrder) {
      const actualFieldId = fieldIdMap.get(columnId)
      if (actualFieldId) {
        const resourceFieldId = toResourceFieldId(entityDefinitionId, toFieldId(actualFieldId))
        resolvedColumnOrder.push(resourceFieldId)
      }
    }

    // Transform column pinning to use ResourceFieldId format
    let resolvedColumnPinning: { left?: string[] } = {}
    if (viewConfig.config.columnPinning?.left) {
      const pinnedLeft: string[] = []
      for (const columnId of viewConfig.config.columnPinning.left) {
        if (columnId === '_checkbox') {
          pinnedLeft.push('_checkbox')
        } else {
          const actualFieldId = fieldIdMap.get(columnId)
          if (actualFieldId) {
            const resourceFieldId = toResourceFieldId(entityDefinitionId, toFieldId(actualFieldId))
            pinnedLeft.push(resourceFieldId)
          }
        }
      }
      resolvedColumnPinning = { left: pinnedLeft }
    }

    // Transform sorting to use ResourceFieldId format
    const resolvedSorting: Array<{ id: string; desc: boolean }> = []
    if (viewConfig.config.sorting) {
      for (const sort of viewConfig.config.sorting) {
        const actualFieldId = fieldIdMap.get(sort.id)
        if (actualFieldId) {
          const resourceFieldId = toResourceFieldId(entityDefinitionId, toFieldId(actualFieldId))
          resolvedSorting.push({
            id: resourceFieldId,
            desc: sort.desc,
          })
        }
      }
    }

    // Create the view
    const [createdView] = await tx
      .insert(schema.TableView)
      .values({
        organizationId: this.organizationId,
        tableId,
        name: viewConfig.name,
        description: viewConfig.description,
        isDefault: true,
        isShared: true,
        config: {
          ...viewConfig.config,
          columnVisibility: resolvedColumnVisibility,
          columnOrder: resolvedColumnOrder,
          columnPinning: resolvedColumnPinning,
          sorting: resolvedSorting,
        },
        updatedAt: new Date(),
      })
      .returning()

    if (!createdView) {
      throw new Error(`Failed to create default view for ${entityType}`)
    }

    logger.info(`Created default view for ${entityType}`, {
      viewId: createdView.id,
      tableId,
    })
  }
}
