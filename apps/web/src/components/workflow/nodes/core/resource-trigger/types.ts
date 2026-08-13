// apps/web/src/components/workflow/nodes/core/resource-trigger/types.ts

import type { CatalogResourceTriggerData } from '@auxx/lib/workflow-engine/client'
import type { ExecutionResult } from '~/components/workflow/types'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/resource-trigger`); re-exported
// here so no web import churns. ResourceTriggerData narrows `type` to the web
// NodeType enum and re-requires `entityDefinitionId` — the catalog admits the
// pre-backfill draft state, but the panel backfills it on mount, so the web
// view is always post-backfill.
export { resourceTriggerNodeDataSchema } from '@auxx/lib/workflow-engine/client'

/**
 * Node data for resource trigger nodes (flattened structure)
 */
export interface ResourceTriggerData extends CatalogResourceTriggerData {
  type: NodeType.RESOURCE_TRIGGER
  entityDefinitionId: string
}

/**
 * Full Resource Trigger node type for React Flow
 */
export type ResourceTriggerNode = SpecificNode<NodeType.RESOURCE_TRIGGER, ResourceTriggerData>

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * Execution result for resource trigger nodes
 */
export interface ResourceTriggerExecutionResult extends ExecutionResult {
  outputs: {
    [resourceKey: string]: any // Dynamic based on resource type (contact, ticket, etc.)
    trigger: {
      timestamp: string
      operation: string
      changedFields?: string[] // For 'updated' operations
      previousValues?: Record<string, any> // For 'updated' operations
      deletedBy?: {
        id: string
        name: string
        email: string
      } // For 'deleted' operations
    }
  }
}
