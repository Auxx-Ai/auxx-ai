// packages/lib/src/seed/entity-seeder/create-field-views.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import {
  createDefaultFieldViewConfig,
  type ViewContextType,
} from '../../conditions/field-view-config'
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
 * Default field view configs for core entities — DIALOG CONTEXTS ONLY.
 *
 * Panel and table default views are NO LONGER seeded. Their field visibility and
 * order are computed live from the registry (`showInPanel` / `showInTable` /
 * `systemSortOrder`), so changing a default is a code-only change with no per-org
 * entity migration (see `use-field-view.ts` / `dynamic-resource-view.tsx`). Only
 * create/edit dialog defaults remain materialized here — create dialogs are
 * allowlists (`includeFields`), awkward to express as per-field registry flags.
 *
 * Uses systemAttribute (from field definitions) for reliable field identification.
 */
export const FIELD_VIEW_CONFIGS: FieldViewSeedConfig[] = [
  // ============================================================================
  // CONTACT DIALOGS
  // ============================================================================
  {
    entityType: 'contact',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['full_name', 'primary_email', 'phone'],
  },
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
  // TICKET DIALOGS
  // ============================================================================
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

  // ============================================================================
  // PART DIALOG
  // ============================================================================
  {
    entityType: 'part',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['part_title', 'part_sku', 'part_description', 'category'],
  },

  // ============================================================================
  // VENDOR PART DIALOG
  // ============================================================================
  {
    entityType: 'vendor_part',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: [
      'vendor_part_part',
      'vendor_part_contact',
      'vendor_part_vendor_sku',
      'vendor_part_unit_price',
      'vendor_part_is_preferred',
    ],
  },

  // ============================================================================
  // COMPANY DIALOG
  // ============================================================================
  {
    entityType: 'company',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: [
      'company_name',
      'company_website',
      'company_industry',
      'company_primary_contact',
    ],
  },

  // ============================================================================
  // MEETING DIALOG
  // ============================================================================
  {
    entityType: 'meeting',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: [
      'meeting_title',
      'meeting_date_time',
      'meeting_type',
      'meeting_company',
      'meeting_contact',
      'meeting_url',
    ],
  },

  // ============================================================================
  // WORK ORDER DIALOG
  // ============================================================================
  {
    entityType: 'work_order',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: [
      'work_order_title',
      'work_order_contact',
      'work_order_priority',
      'work_order_job_type',
      'work_order_company',
      'work_order_address',
      'work_order_description',
    ],
  },

  // ============================================================================
  // SERVICE REQUEST DIALOG
  // ============================================================================
  {
    entityType: 'service_request',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: [
      'service_request_title',
      'service_request_contact',
      'service_request_description',
      'service_request_property_type',
      'service_request_preferred_date',
      'service_request_alternate_date',
      'service_request_arrival_window',
      'service_request_address',
    ],
  },

  // ============================================================================
  // QUOTE DIALOG
  // ============================================================================
  {
    entityType: 'quote',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['quote_title', 'quote_contact', 'quote_request'],
  },

  // ============================================================================
  // INVOICE DIALOG
  // ============================================================================
  {
    entityType: 'invoice',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['invoice_contact', 'invoice_work_order', 'invoice_due_date'],
  },
]

/**
 * Pass 7: Create Default Field Views
 * Seeds default field views for the create/edit DIALOG contexts only, with
 * resolved field IDs. Panel and table defaults are computed live from the
 * registry (`showInPanel` / `showInTable` / `systemSortOrder`) and are no longer
 * materialized — see `FIELD_VIEW_CONFIGS`.
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

  // Otherwise, collect all fields for this entity (excluding specified ones),
  // ordered by the registry's systemSortOrder so the panel/table default order
  // tracks the field registry rather than object-declaration order.
  const collected: { resourceFieldId: string; sortOrder: string }[] = []
  for (const [key, field] of fieldMap.entries()) {
    if (!key.startsWith(`${entityType}:`)) continue
    if (excludeSet.has(field.systemAttribute)) continue

    collected.push({
      resourceFieldId: toResourceFieldId(entityDefId, toFieldId(field.id)),
      sortOrder: field._fieldDef.systemSortOrder ?? 'zz',
    })
  }
  collected.sort((a, b) => a.sortOrder.localeCompare(b.sortOrder))
  result.push(...collected.map((c) => c.resourceFieldId))

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
