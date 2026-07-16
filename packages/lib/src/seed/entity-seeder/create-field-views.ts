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
 * Default field view configs for core entities.
 * Uses systemAttribute (from field definitions) for reliable field identification.
 */
export const FIELD_VIEW_CONFIGS: FieldViewSeedConfig[] = [
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
      'contact_meetings',
      'contact_work_orders',
      'contact_service_requests',
      'contact_quotes',
      'contact_invoices',
      'contact_balance_due',
      'contact_uninvoiced_amount',
      'contact_billing_revision',
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
  // ============================================================================
  // PART FIELD VIEWS
  // ============================================================================

  // Part panel view — hide relationship fields (managed by drawer tabs) + system internals
  {
    entityType: 'part',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'part_quantity_on_hand',
      'part_stock_status',
      // Relationship fields — dedicated drawer tabs exist for these
      'part_vendor_parts',
      'part_subparts',
      'part_used_in_assemblies',
      'part_stock_movements',
    ],
  },

  // Part create dialog — minimal fields for quick creation
  {
    entityType: 'part',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['part_title', 'part_sku', 'part_description', 'category'],
  },

  // ============================================================================
  // VENDOR PART FIELD VIEWS
  // ============================================================================

  // Vendor Part panel view — show all fields except system internals
  {
    entityType: 'vendor_part',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id', 'vendor_part_part'],
  },

  // Vendor Part create dialog — essential fields only
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
  // COMPANY FIELD VIEWS
  // ============================================================================

  // Company panel view — show most fields except system internals
  {
    entityType: 'company',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'company_meetings',
      'company_funding_raised',
    ],
  },

  // Company table view — hide logo (avatar shown inline in table row)
  {
    entityType: 'company',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'company_logo',
      'company_funding_raised',
      'company_x_follower_count',
    ],
  },

  // Company create dialog — minimal fields for quick creation
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
  // MEETING FIELD VIEWS
  // ============================================================================

  // Meeting panel view — show most fields except system internals
  {
    entityType: 'meeting',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
  },

  // Meeting table view — hide long-form note fields in the default list
  {
    entityType: 'meeting',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'meeting_agenda',
      'meeting_notes',
      'meeting_action_items',
    ],
  },

  // Meeting create dialog — essential scheduling fields only
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
  // WORK ORDER FIELD VIEWS
  // ============================================================================
  {
    entityType: 'work_order',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'work_order_pricing_model', // edited with timing in the purpose-built billing-plan flow
      'work_order_invoice_timing', // edited together in the purpose-built billing-plan flow
      // surfaced via the job view's Origin card + line-items/invoice UI, not field rows
      'work_order_quote',
      'work_order_line_items',
      'work_order_invoices',
      'work_order_billing_state',
      'work_order_billing_amount',
      'work_order_amount_drafted',
      'work_order_amount_invoiced',
      'work_order_uninvoiced_amount',
      'work_order_balance_due',
      'work_order_invoice_count',
      'work_order_next_invoice_date',
      'work_order_billing_revision',
    ],
  },
  {
    entityType: 'work_order',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'work_order_description',
      'work_order_completion_notes',
      'work_order_pricing_model', // edited with timing in the purpose-built billing-plan flow
      'work_order_invoice_timing', // edited together in the purpose-built billing-plan flow
      'work_order_billing_state',
      'work_order_billing_amount',
      'work_order_amount_drafted',
      'work_order_amount_invoiced',
      'work_order_uninvoiced_amount',
      'work_order_balance_due',
      'work_order_invoice_count',
      'work_order_next_invoice_date',
      'work_order_billing_revision',
    ],
  },
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
  // SERVICE REQUEST FIELD VIEWS
  // ============================================================================
  {
    entityType: 'service_request',
    contextType: 'panel',
    name: 'Default Panel View',
    // work_orders + quotes render as dedicated overview blocks, not field rows
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'service_request_work_orders',
      'service_request_quotes',
    ],
  },
  {
    entityType: 'service_request',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'service_request_description',
    ],
  },
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
  // QUOTE FIELD VIEWS
  // ============================================================================
  {
    entityType: 'quote',
    contextType: 'panel',
    name: 'Default Panel View',
    // money totals (discount/tax/subtotal/total) live in the line-items card below
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'quote_line_items',
      'quote_work_orders',
      'quote_discount_type',
      'quote_discount_value',
      'quote_tax_rate',
      'quote_subtotal',
      'quote_tax_total',
      'quote_total',
    ],
  },
  {
    entityType: 'quote',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'quote_line_items',
      'quote_work_orders',
      'quote_notes',
      'quote_terms',
      'quote_discount_type',
      'quote_discount_value',
      'quote_tax_name',
    ],
  },
  {
    entityType: 'quote',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['quote_title', 'quote_contact', 'quote_request'],
  },

  // ============================================================================
  // LINE ITEM FIELD VIEWS (no dialog_create — never created via generic dialog)
  // ============================================================================
  {
    entityType: 'line_item',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
  },
  {
    entityType: 'line_item',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'line_item_discount',
      'line_item_sort_order',
      'line_item_visit_id',
    ],
  },

  // ============================================================================
  // CATALOG ITEM FIELD VIEWS (no dialog_create — never created via generic dialog)
  // ============================================================================
  {
    entityType: 'catalog_item',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
  },
  {
    entityType: 'catalog_item',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id', 'catalog_item_line_items'],
  },

  // ============================================================================
  // CATALOG GROUP FIELD VIEWS (no dialog_create — never created via generic dialog)
  // ============================================================================
  {
    entityType: 'catalog_group',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
  },
  {
    entityType: 'catalog_group',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id', 'catalog_group_entries'],
  },

  // ============================================================================
  // INVOICE FIELD VIEWS
  // ============================================================================
  {
    entityType: 'invoice',
    contextType: 'panel',
    name: 'Default Panel View',
    // money totals (discount/tax/subtotal/total) live in the line-items card below
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'invoice_line_items',
      'invoice_payments',
      'invoice_pdf_asset',
      'invoice_discount_type',
      'invoice_discount_value',
      'invoice_tax_rate',
      'invoice_subtotal',
      'invoice_tax_total',
      'invoice_total',
      'invoice_billing_kind',
      'invoice_service_period_start',
      'invoice_service_period_end',
      'invoice_visit_count',
      'invoice_progress_percent',
      'invoice_installment_name',
    ],
  },
  {
    entityType: 'invoice',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: [
      'id',
      'created_at',
      'updated_at',
      'created_by_id',
      'invoice_line_items',
      'invoice_payments',
      'invoice_pdf_asset',
      'invoice_notes',
      'invoice_terms',
      'invoice_discount_type',
      'invoice_discount_value',
      'invoice_tax_name',
      'invoice_billing_kind',
      'invoice_service_period_start',
      'invoice_service_period_end',
      'invoice_visit_count',
      'invoice_progress_percent',
      'invoice_installment_name',
    ],
  },
  {
    entityType: 'invoice',
    contextType: 'dialog_create',
    name: 'Default Create Dialog',
    includeFields: ['invoice_contact', 'invoice_work_order', 'invoice_due_date'],
  },

  // ============================================================================
  // PAYMENT FIELD VIEWS (no dialog_create — the requireLedgerProvenance guard blocks
  // generic creates; the ledger's recordManualPayment is the only writer, §F.3)
  // ============================================================================
  {
    entityType: 'payment',
    contextType: 'panel',
    name: 'Default Panel View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
  },
  {
    entityType: 'payment',
    contextType: 'table',
    name: 'Default Table View',
    excludeFields: ['id', 'created_at', 'updated_at', 'created_by_id'],
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
