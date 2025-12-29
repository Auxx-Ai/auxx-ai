// packages/lib/src/workflow-engine/resources/find-definitions.ts
import { RESOURCE_CONFIGS } from './definitions'
import { RESOURCE_FIELD_REGISTRY, getFilterableFields, getSortableFields } from './registry'
import type { ResourceField } from './registry/field-types'
import type { TableId } from './registry/field-registry'

/**
 * Resource configuration extended for find operations
 */
export interface ResourceFindConfig {
  type: TableId
  label?: string
  schema?: any
  icon?: string
  variableGenerator?: (nodeId: string) => any
  filterableFields: ResourceField[]
  sortableFields: ResourceField[]
  defaultSort?: { field: string; direction: 'asc' | 'desc' }
  defaultLimit?: number
  /** Plural form of the resource type (e.g., 'tickets' for 'ticket') */
  plural: string
  /** Whether this resource supports custom fields */
  supportsCustomFields: boolean
}

/**
 * Build find configuration from registry
 *
 * @param resourceType - Resource type (e.g., 'ticket', 'contact')
 * @returns Find configuration with filterable/sortable fields from registry
 */
function buildFindConfig(resourceType: TableId): ResourceFindConfig {
  const baseConfig = RESOURCE_CONFIGS[resourceType]
  const allFields = RESOURCE_FIELD_REGISTRY[resourceType]

  if (!allFields) {
    throw new Error(`No field registry found for resource: ${resourceType}`)
  }

  return {
    ...baseConfig,
    type: resourceType,
    plural: `${resourceType}s`,

    // Pull from registry capabilities
    filterableFields: getFilterableFields(resourceType),
    sortableFields: getSortableFields(resourceType),

    // Default sorting and pagination
    defaultSort: { field: 'createdAt', direction: 'desc' },
    defaultLimit: resourceType === 'ticket' ? 20 : 10,

    // Custom fields support - only contact and ticket support custom fields
    supportsCustomFields: resourceType === 'contact' || resourceType === 'ticket',
  }
}

/**
 * Resource configurations for find operations
 * Built from the unified resource field registry
 */
export const FIND_RESOURCE_CONFIGS: Record<TableId, ResourceFindConfig> = {
  contact: buildFindConfig('contact'),
  ticket: buildFindConfig('ticket'),
  user: buildFindConfig('user'),
  inbox: buildFindConfig('inbox'),
  participant: buildFindConfig('participant'),
  thread: buildFindConfig('thread'),
  message: buildFindConfig('message'),
  dataset: buildFindConfig('dataset'),
}
