// apps/web/src/components/workflow/nodes/core/var-assign/types.ts

import { BaseType } from '~/components/workflow/types/unified-types'
import { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Single variable assignment configuration
 */
export interface VariableAssignment {
  /** Unique identifier for the assignment */
  id: string
  /** Variable name */
  name: string
  /** Variable type (e.g., STRING, NUMBER, BOOLEAN) */
  type: BaseType
  /** Whether this is an array of the specified type */
  isArray?: boolean
  /** Variable value(s) - can be string or array of strings for array type */
  value: string | string[]
  /** Whether this variable is in constant mode (for single values only) */
  isConstantMode?: boolean
  /** Constant mode tracking for each array item (for array values only) */
  itemConstantModes?: boolean[]
}

/**
 * Variable assignment node data (flattened structure)
 */
export interface VarAssignNodeData extends BaseNodeData {
  /** Array of variable assignments */
  variables: VariableAssignment[]
  /** Whether to ignore type errors during execution */
  ignoreTypeError?: boolean
}

/**
 * Full Var Assign node type for React Flow
 */
export type VarAssignNode = SpecificNode<'var-assign', VarAssignNodeData>
