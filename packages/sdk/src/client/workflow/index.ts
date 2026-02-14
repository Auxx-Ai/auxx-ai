// packages/sdk/src/client/workflow/index.ts

/**
 * Auxx Workflow Client SDK
 *
 * This module provides React components and hooks for building workflow block and trigger UIs.
 */

// Re-export workflow types
export type {
  BaseType,
  Connection,
  InferWorkflowInput,
  InferWorkflowOutput,
  WorkflowBlock,
  WorkflowCategory,
  WorkflowExecutionContext,
  WorkflowOrganization,
  WorkflowSchema,
  WorkflowSDK,
  WorkflowTrigger,
  WorkflowUser,
} from '../../root/workflow/types.js'

// Re-export all components
export * from './components/index.js'
// Re-export all hooks
export * from './hooks/index.js'
// Re-export path helper types
export type { PathTo, PathToField, ValueAtPath } from './types/index.js'
