// apps/web/src/components/workflow/nodes/core/code/types.ts

import { BaseNodeData, SpecificNode, ExecutionResult, VariableSelector } from '../../../types'
import { BaseType } from '../../../types/unified-types'

/**
 * Variable input for code execution
 */
export interface CodeVariable {
  variable: string
  value_selector: VariableSelector
}

/**
 * Output definition for code node
 */
export interface CodeNodeOutput {
  name: string
  type: BaseType
  description?: string
}

/**
 * Legacy output format
 */
export interface CodeOutput {
  [key: string]: { type: 'string' | 'number' | 'object' | 'array'; children?: any }
}

/**
 * Input definition for code node
 */
export interface CodeNodeInput {
  name: string
  variableId: string
}

/**
 * Node data for code nodes (flattened structure)
 */
export interface CodeNodeData extends BaseNodeData {
  variables?: CodeVariable[]
  code_language: 'python3' | 'javascript'
  code: string
  inputs?: CodeNodeInput[]
  outputs?: CodeNodeOutput[]
  legacyOutputs?: CodeOutput
}

/**
 * Full Code node type for React Flow
 */
export type CodeNode = SpecificNode<'code', CodeNodeData>

/**
 * Input data for code execution
 */
export interface CodeInput {
  data: any
}

/**
 * Execution result for code nodes
 */
export interface CodeExecutionResult extends ExecutionResult {
  outputs: { result: any; logs: string[] }
}
