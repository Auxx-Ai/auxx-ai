// apps/web/src/components/workflow/nodes/core/crud/types.ts

import type { CatalogCrudNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/crud`); re-exported here so no web
// import churns. CrudNodeData narrows `type` to the web NodeType enum, same
// as BaseNodeData does over its lib counterpart.
export {
  type CrudDefaultValue,
  createCrudNodeDefaultData,
  crudNodeDataSchema,
  // One failure-policy vocabulary now (plan 21 §15.1) — `CrudErrorStrategy`
  // and http's old `ErrorStrategy` were two enums for the same concern.
  ErrorStrategy,
} from '@auxx/lib/workflow-engine/client'

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }>
}

/**
 * CRUD node data interface
 */
export interface CrudNodeData extends CatalogCrudNodeData {
  type: NodeType.CRUD
}

/**
 * Specific CRUD node type
 */
export type CrudNode = SpecificNode<'crud', CrudNodeData>
