// packages/lib/src/resources/registry/field-registry.ts

import { type ModelType, ModelTypeMeta, ModelTypeValues } from '@auxx/database/enums'
import type { FieldId } from '@auxx/types/field'
import { ENTITY_DEFINITION_TYPES } from '@auxx/types/resource'
import type { ResourceField, ResourceFieldRegistry, ResourceTableDefinition } from './field-types'
import { ARTICLE_FIELDS } from './resources/article-fields'
import { BUILD_FIELDS } from './resources/build-fields'
import { CATALOG_GROUP_FIELDS } from './resources/catalog-group-fields'
import { CATALOG_ITEM_FIELDS } from './resources/catalog-item-fields'
import { COMPANY_FIELDS } from './resources/company-fields'
import { CONTACT_FIELDS } from './resources/contact-fields'
import { DATASET_FIELDS } from './resources/dataset-fields'
import { GL_ACCOUNT_FIELDS } from './resources/gl-account-fields'
import { INBOX_FIELDS } from './resources/inbox-fields'
import { INVOICE_FIELDS } from './resources/invoice-fields'
import { KB_FIELDS } from './resources/kb-fields'
import { LINE_ITEM_FIELDS } from './resources/line-item-fields'
import { MEETING_FIELDS } from './resources/meeting-fields'
import { MESSAGE_FIELDS } from './resources/message-fields'
import { ORDER_FIELDS } from './resources/order-fields'
import { PART_FIELDS } from './resources/part-fields'
import { PARTICIPANT_FIELDS } from './resources/participant-fields'
import { PAYMENT_FIELDS } from './resources/payment-fields'
import { PERSONAL_INBOX_FIELDS } from './resources/personal-inbox-fields'
import { PRODUCT_FIELDS } from './resources/product-fields'
import { PURCHASE_ORDER_FIELDS } from './resources/purchase-order-fields'
import { PURCHASE_ORDER_LINE_FIELDS } from './resources/purchase-order-line-fields'
import { QUOTE_FIELDS } from './resources/quote-fields'
import { SERVICE_REQUEST_FIELDS } from './resources/service-request-fields'
import { SIGNATURE_FIELDS } from './resources/signature-fields'
import { STOCK_MOVEMENT_FIELDS } from './resources/stock-movement-fields'
import { SUBPART_FIELDS } from './resources/subpart-fields'
import { TARIFF_CODE_FIELDS } from './resources/tariff-code-fields'
import { TARIFF_RATE_FIELDS } from './resources/tariff-rate-fields'
import { THREAD_FIELDS } from './resources/thread-fields'
import { TICKET_FIELDS } from './resources/ticket-fields'
import { USER_FIELDS } from './resources/user-fields'
import { VENDOR_BILL_FIELDS } from './resources/vendor-bill-fields'
import { VENDOR_BILL_LINE_FIELDS } from './resources/vendor-bill-line-fields'
import { VENDOR_PART_FIELDS } from './resources/vendor-part-fields'
import { VENDOR_PAYMENT_ALLOCATION_FIELDS } from './resources/vendor-payment-allocation-fields'
import { VENDOR_PAYMENT_FIELDS } from './resources/vendor-payment-fields'
import { VISIT_FIELDS } from './resources/visit-fields'
import { WORK_ORDER_FIELDS } from './resources/work-order-fields'

/** Types excluded from RESOURCE_TABLE_REGISTRY: 'entity' (generic marker) + all EntityDefinition types */
const excludedTypes = new Set<string>(['entity', ...ENTITY_DEFINITION_TYPES])

/**
 * Resource Table Registry - Metadata about resource tables themselves
 * Derived from ModelTypeMeta for consistency (excludes entity definition types)
 *
 * This is the single source of truth for table-level metadata (labels, icons, plurals, colors, apiSlugs, etc.)
 */
export const RESOURCE_TABLE_REGISTRY = ModelTypeValues.filter((id) => !excludedTypes.has(id)).map(
  (id) => ({
    id,
    label: ModelTypeMeta[id].label,
    plural: ModelTypeMeta[id].plural,
    icon: ModelTypeMeta[id].icon,
    color: ModelTypeMeta[id].color,
    apiSlug: ModelTypeMeta[id].apiSlug,
    dbName: ModelTypeMeta[id].dbTable,
  })
)

/**
 * TableId - valid system table identifiers (excludes 'entity' and EntityDefinition types)
 */
export type TableId = Exclude<ModelType, 'entity'>

/**
 * Helper map for O(1) lookup by table ID
 * Automatically derived from the array for convenient access
 */
export const RESOURCE_TABLE_MAP = Object.fromEntries(
  RESOURCE_TABLE_REGISTRY.map((table) => [table.id, table])
) as Record<TableId, ResourceTableDefinition>

/**
 * Runtime type guard to validate if a string is a valid TableId
 * Useful for validating external input or dynamic resource type strings
 *
 * @param value - The string to check
 * @returns True if the value is a valid TableId
 *
 * @example
 * ```typescript
 * const resourceType = getResourceTypeFromApi()
 * if (isValidTableId(resourceType)) {
 *   // Safe to use as TableId
 *   processResource(resourceType)
 * } else {
 *   throw new Error(`Invalid resource type: ${resourceType}`)
 * }
 * ```
 */
export function isValidTableId(value: string): value is TableId {
  return RESOURCE_TABLE_REGISTRY.some((table) => table.id === value)
}

/**
 * Resource Field Registry - Single source of truth for all resource fields
 *
 * This registry defines all fields for each resource type and specifies
 * their capabilities (filterable, sortable, creatable, updatable).
 *
 * IMPORTANT: This is the authoritative source for field definitions.
 * Both CRUD and Find nodes should derive their field lists from this registry.
 *
 * Each resource's field definitions are maintained in separate files under ./resources/
 * for better organization and maintainability.
 */
export const RESOURCE_FIELD_REGISTRY: ResourceFieldRegistry = {
  ticket: TICKET_FIELDS,
  contact: CONTACT_FIELDS,
  user: USER_FIELDS,
  inbox: INBOX_FIELDS,
  personal_inbox: PERSONAL_INBOX_FIELDS,
  participant: PARTICIPANT_FIELDS,
  thread: THREAD_FIELDS,
  message: MESSAGE_FIELDS,
  dataset: DATASET_FIELDS,
  part: PART_FIELDS,
  signature: SIGNATURE_FIELDS,
  vendor_part: VENDOR_PART_FIELDS,
  subpart: SUBPART_FIELDS,
  stock_movement: STOCK_MOVEMENT_FIELDS,
  company: COMPANY_FIELDS,
  meeting: MEETING_FIELDS,
  article: ARTICLE_FIELDS,
  kb: KB_FIELDS,
  work_order: WORK_ORDER_FIELDS,
  visit: VISIT_FIELDS,
  service_request: SERVICE_REQUEST_FIELDS,
  quote: QUOTE_FIELDS,
  line_item: LINE_ITEM_FIELDS,
  catalog_item: CATALOG_ITEM_FIELDS,
  catalog_group: CATALOG_GROUP_FIELDS,
  invoice: INVOICE_FIELDS,
  payment: PAYMENT_FIELDS,
  product: PRODUCT_FIELDS,
  order: ORDER_FIELDS,
  purchase_order: PURCHASE_ORDER_FIELDS,
  purchase_order_line: PURCHASE_ORDER_LINE_FIELDS,
  vendor_bill: VENDOR_BILL_FIELDS,
  vendor_bill_line: VENDOR_BILL_LINE_FIELDS,
  vendor_payment: VENDOR_PAYMENT_FIELDS,
  vendor_payment_allocation: VENDOR_PAYMENT_ALLOCATION_FIELDS,
  gl_account: GL_ACCOUNT_FIELDS,
  build: BUILD_FIELDS,
  tariff_code: TARIFF_CODE_FIELDS,
  tariff_rate: TARIFF_RATE_FIELDS,
}

/**
 * Helper to get field by ID with type safety.
 * Searches for a field in the registry by its FieldId.
 */
export function getFieldById(tableId: TableId, fieldId: FieldId): ResourceField | undefined {
  const fields = RESOURCE_FIELD_REGISTRY[tableId]
  if (!fields) return undefined

  // Search by id
  return Object.values(fields).find((f) => f.id === fieldId)
}

/**
 * Set of all system field keys across all resource types.
 * Used to detect when field values are passed using field keys (e.g., 'name', 'status')
 * instead of CustomField UUIDs.
 *
 * @example
 * // Check if a key needs mapping to CustomField UUID
 * if (SYSTEM_FIELD_KEYS.has('name')) {
 *   // 'name' is a system field key, needs mapping
 * }
 */
export const SYSTEM_FIELD_KEYS = new Set(
  Object.values(RESOURCE_FIELD_REGISTRY).flatMap((fields) => Object.keys(fields))
)
