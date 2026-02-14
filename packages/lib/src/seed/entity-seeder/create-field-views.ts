// packages/lib/src/seed/entity-seeder/create-field-views.ts

import { type Database, schema } from '@auxx/database'
import {
  createDefaultFieldViewConfig,
  type FieldViewConfig,
  type ViewContextType,
} from '@auxx/lib/conditions'
import { createScopedLogger } from '@auxx/logger'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import type { EntityDefMap, FieldMap } from './types'

const logger = createScopedLogger('entity-seeder:create-field-views')

/**
 * Field view seed configuration for an entity type and context
 */
interface FieldViewSeedConfig {
  entityType: string
  contextType: ViewContextType
  name: string
  /** Field systemAttributes to include (in order). If omitted, includes all panel-visible fields. */
  includeFields?: string[]
  /** Field systemAttributes to exclude */
  excludeFields?: string[]
}

/**
 * Default field view configs for core entities.
 * Uses systemAttribute (from field definitions) for reliable field identification.
 */
const FIELD_VIEW_CONFIGS: FieldViewSeedConfig[] = [
  // ============================================================================
  // CONTACT FIELD VIEWS
  // ============================================================================

  // Contact panel view - shows most fields except system internals
  {
    entityType: 'contact',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'first_name',
      'last_name',
      'contact_tickets',
    ],
  },

  // Contact create dialog - minimal fields for quick creation
  {
    entityType: 'contact',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['full_name', 'primary_email', 'phone'],
  },

  // Contact edit dialog - editable fields (excludes auto-generated)
  {
    entityType: 'contact',
    contextType: 'dialog_edit',
    name: 'Default Edit Dialog',
    excludeFields: [
      'id',
      'created_at',
      'first_name',
      'last_name',
      'contact_tickets',
      'customer_groups',
    ],
  },

  // ============================================================================
  // TICKET FIELD VIEWS
  // ============================================================================

  // Ticket panel view - shows most fields except system internals
  {
    entityType: 'ticket',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'parent_ticket_id',
      'ticket_child_tickets',
    ],
  },

  // Ticket create dialog - essential fields for ticket creation
  {
    entityType: 'ticket',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: [
      'ticket_title',
      'ticket_contact',
      'ticket_priority',
      'assigned_to_id',
      'ticket_description',
    ],
  },

  // Ticket edit dialog - editable fields (excludes auto-generated)
  {
    entityType: 'ticket',
    contextType: 'dialog_edit',
    name: 'Default Edit Dialog',
    excludeFields: [
      'id',
      'created_at',
      'ticket_number',
      'ticket_type',
      'parent_ticket_id',
      'ticket_child_tickets',
    ],
  },
]

/**
 * Pass 7: Create Default Field Views
 * Create default field views for panel and dialog contexts with resolved field IDs.
 */
export async function createFieldViews(
  db: Database,
  organizationId: string,
  userId: string,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): Promise<void> {
  const now = new Date()

  for (const config of FIELD_VIEW_CONFIGS) {
    const { entityType, contextType, name, includeFields, excludeFields } = config

    const entityDef = entityDefMap.get(entityType)
    if (!entityDef) {
      logger.warn(`EntityDefinition not found for ${entityType}, skipping field view creation`)
      continue
    }

    // Build resourceFieldId list from fieldMap
    const fieldIds = buildFieldIdList(
      entityType,
      entityDef.id,
      fieldMap,
      includeFields,
      excludeFields
    )

    if (fieldIds.length === 0) {
      logger.warn(`No fields found for ${entityType} ${contextType}, skipping field view creation`)
      continue
    }

    // Create field view config with visibility and order
    const fieldViewConfig = createDefaultFieldViewConfig(fieldIds)

    // If includeFields provided, mark all other fields as hidden
    if (includeFields?.length) {
      const includedSet = new Set(fieldIds)
      for (const [key, field] of fieldMap.entries()) {
        if (!key.startsWith(`${entityType}:`)) continue
        const resourceFieldId = toResourceFieldId(entityDef.id, toFieldId(field.id))
        if (!includedSet.has(resourceFieldId)) {
          fieldViewConfig.fieldVisibility[resourceFieldId] = false
        }
      }
    }

    // If excludeFields provided without includeFields, mark excluded as hidden
    if (!includeFields && excludeFields?.length) {
      for (const systemAttr of excludeFields) {
        const fieldId = findFieldIdBySystemAttr(entityType, entityDef.id, fieldMap, systemAttr)
        if (fieldId) {
          fieldViewConfig.fieldVisibility[fieldId] = false
        }
      }
    }

    const tableId = entityDef.id

    const [createdView] = await db
      .insert(schema.TableView)
      .values({
        organizationId,
        userId,
        tableId,
        name,
        contextType,
        isDefault: true,
        isShared: true,
        config: fieldViewConfig,
        updatedAt: now,
      })
      .returning()

    if (!createdView) {
      throw new Error(`Failed to create field view for ${entityType} ${contextType}`)
    }

    logger.debug(`Created field view for ${entityType} ${contextType}`, {
      viewId: createdView.id,
      tableId,
      fieldCount: fieldIds.length,
    })
  }
}

/**
 * Build resourceFieldId list from the fieldMap based on include/exclude config
 */
function buildFieldIdList(
  entityType: string,
  entityDefId: string,
  fieldMap: FieldMap,
  includeFields?: string[],
  excludeFields?: string[]
): string[] {
  const result: string[] = []
  const excludeSet = new Set(excludeFields ?? [])

  // If includeFields is specified, use that order
  if (includeFields?.length) {
    for (const systemAttr of includeFields) {
      const fieldId = findFieldIdBySystemAttr(entityType, entityDefId, fieldMap, systemAttr)
      if (fieldId) {
        result.push(fieldId)
      }
    }
    return result
  }

  // Otherwise, collect all fields for this entity (excluding specified ones)
  for (const [key, field] of fieldMap.entries()) {
    if (!key.startsWith(`${entityType}:`)) continue
    if (excludeSet.has(field.systemAttribute)) continue

    const resourceFieldId = toResourceFieldId(entityDefId, toFieldId(field.id))
    result.push(resourceFieldId)
  }

  return result
}

/**
 * Find resourceFieldId by systemAttribute
 */
function findFieldIdBySystemAttr(
  entityType: string,
  entityDefId: string,
  fieldMap: FieldMap,
  systemAttr: string
): string | null {
  for (const [key, field] of fieldMap.entries()) {
    if (!key.startsWith(`${entityType}:`)) continue
    if (field.systemAttribute === systemAttr) {
      return toResourceFieldId(entityDefId, toFieldId(field.id))
    }
  }
  return null
}
