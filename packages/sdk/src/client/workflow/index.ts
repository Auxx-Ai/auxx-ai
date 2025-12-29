// packages/sdk/src/client/workflow/index.ts

/**
 * Auxx Workflow Client SDK
 *
 * This module provides React components and hooks for building workflow block and trigger UIs.
 */

// Re-export all hooks
export * from './hooks/index.js'

// Re-export all components
export * from './components/index.js'

// Re-export path helper types
export type { PathTo, PathToField, ValueAtPath } from './types/index.js'

// Re-export workflow types
export type {
  BaseType,
  WorkflowCategory,
  Connection,
  WorkflowUser,
  WorkflowOrganization,
  WorkflowSDK,
  WorkflowExecutionContext,
  WorkflowSchema,
  WorkflowBlock,
  WorkflowTrigger,
  InferWorkflowInput,
  InferWorkflowOutput,
} from '../../root/workflow/types.js'
