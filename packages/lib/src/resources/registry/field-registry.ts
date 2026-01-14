// packages/lib/src/resources/registry/field-registry.ts

import type { ResourceFieldRegistry, ResourceTableDefinition } from './field-types'
import { TICKET_FIELDS } from './resources/ticket-fields'
import { CONTACT_FIELDS } from './resources/contact-fields'
import { USER_FIELDS } from './resources/user-fields'
import { INBOX_FIELDS } from './resources/inbox-fields'
import { PARTICIPANT_FIELDS } from './resources/participant-fields'
import { THREAD_FIELDS } from './resources/thread-fields'
import { MESSAGE_FIELDS } from './resources/message-fields'
import { DATASET_FIELDS } from './resources/dataset-fields'
import { PART_FIELDS } from './resources/part-fields'
import { ModelTypeValues, ModelTypeMeta, type ModelType } from '@auxx/database/enums'

/**
 * Resource types to exclude from the registry
 * - 'entity' is handled via EntityDefinition
 * - 'contact' is excluded from table registry
 */
const EXCLUDED_RESOURCE_TYPES = ['entity'] as const

/**
 * Resource Table Registry - Metadata about resource tables themselves
 * Derived from ModelTypeMeta for consistency (excludes types in EXCLUDED_RESOURCE_TYPES)
 *
 * This is the single source of truth for table-level metadata (labels, icons, plurals, colors, apiSlugs, etc.)
 */
export const RESOURCE_TABLE_REGISTRY = ModelTypeValues.filter(
  (id) => !EXCLUDED_RESOURCE_TYPES.includes(id as any)
).map((id) => ({
  id,
  label: ModelTypeMeta[id].label,
  plural: ModelTypeMeta[id].plural,
  icon: ModelTypeMeta[id].icon,
  color: ModelTypeMeta[id].color,
  apiSlug: ModelTypeMeta[id].apiSlug,
  dbName: ModelTypeMeta[id].dbTable,
}))

/**
 * TableId - valid system table identifiers (excludes types in EXCLUDED_RESOURCE_TYPES)
 */
export type TableId = Exclude<ModelType, 'entity' | 'contact'>

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
  participant: PARTICIPANT_FIELDS,
  thread: THREAD_FIELDS,
  message: MESSAGE_FIELDS,
  dataset: DATASET_FIELDS,
  part: PART_FIELDS,
}
