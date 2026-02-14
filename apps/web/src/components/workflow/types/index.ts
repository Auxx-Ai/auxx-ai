// apps/web/src/components/workflow/types/index.ts

// Core types
export type {
  BranchType,
  ComparisonOperator,
  EnvVar,
  FetchWorkflowResponse,
  TargetBranch,
  VariableSelector,
} from './core'
// Execution types
export type {
  ExecutionContext,
  ExecutionResult,
  ServiceContainer,
  SystemContext,
} from './execution'
// Node base types
export type {
  BaseNodeConfig,
  BaseNodeData,
  CommonNodeType,
  Edge,
  EdgeData,
  FlowEdge,
  FlowNode,
  NodeConnectionMetadata,
  NodeLoopContext,
  NodeProps,
  NodeRuntimeState,
  SelectedNode,
  SpecificNode,
  WorkflowNode,
  WorkflowRetryConfig,
} from './node-base'
export { ErrorHandleType, isNodeOfType, isWorkflowNode, NodeRunningStatus } from './node-base'
// Node type enums
export { getNodeTypeDisplayName, isNodeType, NodeType } from './node-types'
// Output variable types
export type { OutputVariable } from './output-variables'
export { createOutputVariable } from './output-variables'
export type { NodeDefinition, NodePanelProps, ValidationResult } from './registry'
// Registry types
export { NodeCategory } from './registry'

// variable types
export { BaseType } from './unified-types'

export type { UnifiedVariable, VariableGroup, VarMode } from './variable-types'
export { VAR_MODE } from './variable-types'
