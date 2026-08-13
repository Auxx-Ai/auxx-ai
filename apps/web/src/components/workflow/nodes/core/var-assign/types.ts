// apps/web/src/components/workflow/nodes/core/var-assign/types.ts

import type { CatalogVarAssignNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/var-assign`).
export type { VariableAssignment } from '@auxx/lib/workflow-engine/client'

/**
 * Variable assignment node data (flattened structure)
 */
export interface VarAssignNodeData extends CatalogVarAssignNodeData {
  type: NodeType
}

/**
 * Full Var Assign node type for React Flow
 */
export type VarAssignNode = SpecificNode<'var-assign', VarAssignNodeData>
