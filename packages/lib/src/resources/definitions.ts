// packages/lib/src/workflow-engine/resources/definitions.ts
import { RESOURCE_TABLE_MAP, type TableId } from './registry/field-registry'
import {
  createDatasetVariables,
  createMessageVariables,
  createThreadVariables,
} from './variable-generators'

/**
 * Configuration for a resource type (contact, ticket, etc.)
 */
export interface ResourceConfig {
  type: TableId
  label: string
  icon?: string
  variableGenerator: (nodeId: string) => any // UnifiedVariable shape
}

/**
 * Configuration for a resource operation (created, updated, deleted)
 */
export interface ResourceOperation {
  operation: string
  label: string
  triggerName: (resourceType: TableId) => string
}

/**
 * Available resource operations
 */
export const RESOURCE_OPERATIONS: Record<string, ResourceOperation> = {
  created: {
    operation: 'created',
    label: 'Created',
    triggerName: (resourceType) => `${resourceType.toLowerCase()}-created`,
  },
  updated: {
    operation: 'updated',
    label: 'Updated',
    triggerName: (resourceType) => `${resourceType.toLowerCase()}-updated`,
  },
  deleted: {
    operation: 'deleted',
    label: 'Deleted',
    triggerName: (resourceType) => `${resourceType.toLowerCase()}-deleted`,
  },
  manual: {
    operation: 'manual',
    label: 'Manual',
    triggerName: (resourceType) => `${resourceType.toLowerCase()}-manual`,
  },
}

/**
 * Available resource configurations
 * Uses registry metadata for consistency
 * Note: Only resources with custom variable generators are included here.
 * Other resources use the generic createResourceVariables function.
 *
 * `contact`/`ticket` entries used to live here (commented out) pointing at
 * `createContactVariables`/`createTicketVariables` — those two functions had
 * no live caller (their only reference was this dead code) and were deleted
 * from `variable-generators.ts` in the variable-generators hygiene pass.
 * Reintroducing contact/ticket-specific generation here would mean writing
 * new functions, not restoring the deleted ones.
 */
export const RESOURCE_CONFIGS: Partial<Record<TableId, ResourceConfig>> = {
  thread: {
    type: 'thread',
    label: RESOURCE_TABLE_MAP.thread.label,
    icon: RESOURCE_TABLE_MAP.thread.icon,
    variableGenerator: createThreadVariables,
  },
  message: {
    type: 'message',
    label: RESOURCE_TABLE_MAP.message.label,
    icon: RESOURCE_TABLE_MAP.message.icon,
    variableGenerator: createMessageVariables,
  },
  dataset: {
    type: 'dataset',
    label: RESOURCE_TABLE_MAP.dataset.label,
    icon: RESOURCE_TABLE_MAP.dataset.icon,
    variableGenerator: createDatasetVariables,
  },
}
