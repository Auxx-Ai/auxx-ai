// packages/sdk/src/server/workflow/index.ts

export type { PollingExecuteResult, PollingState } from '../../root/workflow/types.js'

/**
 * Workflow input definition
 */
export interface WorkflowInput {
  /** Unique identifier for the input */
  id: string
  /** Display label */
  label: string
  /** Input type */
  type: 'string' | 'number' | 'boolean' | 'date' | 'json'
  /** Whether this input is required */
  required?: boolean
  /** Default value */
  defaultValue?: any
  /** Help text */
  description?: string
}

/**
 * Workflow output definition
 */
export interface WorkflowOutput {
  /** Unique identifier for the output */
  id: string
  /** Display label */
  label: string
  /** Output type */
  type: 'string' | 'number' | 'boolean' | 'date' | 'json'
  /** Help text */
  description?: string
}

/**
 * Context provided to workflow blocks during execution
 */
export interface WorkflowContext {
  /** The current workflow execution ID */
  executionId: string
  /** Input values for this block */
  inputs: Record<string, any>
  /** Metadata about the workflow */
  metadata: {
    /** Workflow ID */
    workflowId: string
    /** Trigger that started this workflow */
    trigger?: string
    /** Timestamp when the workflow started */
    startedAt: Date
  }
}

/**
 * A workflow step block that can be used in workflows
 */
// export interface WorkflowStepBlock {
//   /** Unique identifier for the block */
//   id: string
//   /** Display label */
//   label: string
//   /** Block description */
//   description?: string
//   /** Icon for the block */
//   icon?: string
//   /** Input definitions */
//   inputs: WorkflowInput[]
//   /** Output definitions */
//   outputs: WorkflowOutput[]
//   /** Execute function called when the block runs */
//   execute: (context: WorkflowContext) => Promise<Record<string, any>>
// }

/**
 * Context provided to workflow triggers
 */
export interface TriggerContext {
  /** App ID */
  appId: string
  /** Configuration for this trigger instance */
  config: Record<string, any>
  /** Function to emit events that start workflows */
  emit: (data: Record<string, any>) => Promise<void>
}

/**
 * A workflow trigger block that can start workflows
 */
// export interface WorkflowTriggerBlock {
//   /** Unique identifier for the trigger */
//   id: string
//   /** Display label */
//   label: string
//   /** Trigger description */
//   description?: string
//   /** Icon for the trigger */
//   icon?: string
//   /** Configuration inputs */
//   config: WorkflowInput[]
//   /** Output definitions (data provided when trigger fires) */
//   outputs: WorkflowOutput[]
//   /** Setup function called when trigger is activated */
//   setup: (context: TriggerContext) => Promise<void> | void
//   /** Teardown function called when trigger is deactivated */
//   teardown?: (context: TriggerContext) => Promise<void> | void
// }
