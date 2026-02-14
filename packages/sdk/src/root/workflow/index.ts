// packages/sdk/src/root/workflow/index.ts

// Export types
export * from './types.js'

// Export utility types
export type { InputOf, OutputOf, SchemaOf } from './utils.js'

// Import and export base node and options
import { type BaseWorkflowFieldOptions, WorkflowFieldNode } from './base-node.js'
export { WorkflowFieldNode, type BaseWorkflowFieldOptions }

// Re-export SelectOption from schema
export type { SelectOption } from '../schema/select-node.js'

// Import input field classes (needed for type utilities below)
import {
  WorkflowArrayNode,
  WorkflowBooleanNode,
  WorkflowNumberNode,
  WorkflowSelectNode,
  WorkflowStringNode,
  WorkflowStructNode,
} from './input-nodes.js'

// Export input field types
export type {
  ArrayInputOptions,
  BooleanInputOptions,
  NumberInputOptions,
  SelectInputOptions,
  StringInputOptions,
  StructInputOptions,
} from './input-nodes.js'

// Re-export input field classes
export {
  WorkflowStringNode,
  WorkflowNumberNode,
  WorkflowBooleanNode,
  WorkflowSelectNode,
  WorkflowArrayNode,
  WorkflowStructNode,
}

// Import specialized string format helpers from schema
import { date, datetime, email, type StringFormat, time, url } from '../schema/index.js'
// Import and export AuxxRule field
import { AuxxRuleReference, auxxRule, WorkflowAuxxRuleNode } from './auxx-rule-node.js'
// Import input factories (not exported directly - only via Workflow namespace)
import { array, boolean, number, select, string, struct } from './input-nodes.js'
export { auxxRule, AuxxRuleReference, WorkflowAuxxRuleNode }
export type { AuxxRuleWorkflowFieldOptions } from './auxx-rule-node.js'
export { createMockTransformationContext } from './values/mock-context.js'
// Export transformation utilities
export {
  deserializeSchemaValues,
  serializeSchemaValues,
  transformSchemaToConfig,
  transformSchemaToRuntime,
} from './values/transform.js'
export type { TransformationContext } from './values/types.js'

// ============================================================================
// Workflow Namespace
// ============================================================================

/**
 * Workflow namespace for cleaner API
 *
 * Provides a unified interface for creating workflow input fields.
 *
 * @example
 * ```typescript
 * import { Workflow } from '@auxx/sdk'
 *
 * const schema = {
 *   inputs: {
 *     email: Workflow.string({ label: 'Email', acceptsVariables: true }),
 *     count: Workflow.number({ label: 'Count', min: 1 }),
 *     enabled: Workflow.boolean({ label: 'Enabled', default: false }),
 *     dueDate: Workflow.date({ label: 'Due Date', required: true }),
 *   },
 * }
 * ```
 */
export const Workflow = {
  // Primitive types
  string,
  number,
  boolean,

  // Specialized string formats
  date,
  datetime,
  time,
  email,
  url,

  // Complex types
  select,
  array,
  struct,
} as const

// Export StringFormat type for use in workflow definitions
export type { StringFormat }

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Union type of all workflow field node types
 */
export type WorkflowNode =
  | WorkflowStringNode
  | WorkflowNumberNode
  | WorkflowBooleanNode
  | WorkflowSelectNode
  | WorkflowArrayNode
  | WorkflowStructNode
  | WorkflowAuxxRuleNode

/**
 * Enhanced type inference for workflow field types
 */
export type InferFieldType<T> = T extends WorkflowStringNode
  ? string
  : T extends WorkflowNumberNode
    ? number
    : T extends WorkflowBooleanNode
      ? boolean
      : T extends WorkflowSelectNode<infer TOptions>
        ? TOptions extends readonly (infer U)[]
          ? U extends string
            ? U
            : U extends { value: infer V }
              ? V
              : string
          : string
        : T extends WorkflowArrayNode<infer TItem>
          ? InferFieldType<TItem>[]
          : T extends WorkflowStructNode<infer TFields>
            ? { [K in keyof TFields]: InferFieldType<TFields[K]> }
            : T extends WorkflowFieldNode<any, infer TValue, any>
              ? TValue
              : never

/**
 * Infer the input type from a workflow schema
 */
export type InferWorkflowInput<TSchema> = TSchema extends { inputs: infer TInput }
  ? { [K in keyof TInput]: InferFieldType<TInput[K]> }
  : never

/**
 * Infer the output type from a workflow schema
 */
export type InferWorkflowOutput<TSchema> = TSchema extends { outputs: infer TOutput }
  ? { [K in keyof TOutput]: InferFieldType<TOutput[K]> }
  : never
