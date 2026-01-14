// apps/web/src/components/workflow/types/index.ts

// Core types
export type {
  VariableSelector,
  ComparisonOperator,
  TargetBranch,
  BranchType,
  EnvVar,
  FetchWorkflowResponse,
} from './core'

// Node base types
export type {
  BaseNodeConfig,
  BaseNodeData,
  CommonNodeType,
  SpecificNode,
  WorkflowNode,
  FlowNode,
  FlowEdge,
  EdgeData,
  Edge,
  SelectedNode,
  NodeProps,
  NodeConnectionMetadata,
  NodeRuntimeState,
  NodeLoopContext,
  WorkflowRetryConfig,
} from './node-base'

export { isWorkflowNode, isNodeOfType, NodeRunningStatus, ErrorHandleType } from './node-base'

// Execution types
export type {
  SystemContext,
  ExecutionContext,
  ExecutionResult,
  ServiceContainer,
} from './execution'

// Registry types
export { NodeCategory } from './registry'

export type { ValidationResult, NodeDefinition, NodePanelProps } from './registry'

// Output variable types
export type { OutputVariable } from './output-variables'
export { createOutputVariable } from './output-variables'

// Node type enums
export { NodeType, isNodeType, getNodeTypeDisplayName } from './node-types'

// variable types
export { BaseType } from './unified-types'

export type { UnifiedVariable, VariableGroup, VarMode } from './variable-types'
export { VAR_MODE } from './variable-types'
