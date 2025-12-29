// packages/sdk/src/root/workflow/types.ts

import type { ComponentType } from 'react'

/**
 * Base types for workflow variables
 */
export enum BaseType {
  // Primitives
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  NULL = 'null',
  ANY = 'any',

  // Structured
  OBJECT = 'object',
  ARRAY = 'array',

  // Specialized
  EMAIL = 'email',
  URL = 'url',
  DATE = 'date',
  DATETIME = 'datetime',
  TIME = 'time',
  JSON = 'json',
  FILE = 'file',

  // References
  REFERENCE = 'reference',
}

/**
 * Workflow block categories for organization in the UI
 */
export type WorkflowCategory =
  | 'trigger'
  | 'action'
  | 'logic'
  | 'transform'
  | 'integration'
  | 'ai'
  | 'data'
  | 'utility'
  | 'social'

/**
 * Connection information for authenticated API access
 */
export interface Connection {
  /** Connection ID */
  id: string
  /** Connection type (e.g., 'github', 'slack', 'google') */
  type: string
  /** Connection value (e.g., access token, API key) */
  value: string
  /** Additional connection metadata */
  metadata?: Record<string, any>
}

/**
 * User information in workflow context
 */
export interface WorkflowUser {
  /** User ID */
  id: string
  /** User email */
  email: string
  /** User name */
  name: string
}

/**
 * Organization information in workflow context
 */
export interface WorkflowOrganization {
  /** Organization ID */
  id: string
  /** Organization handle */
  handle: string
  /** Organization name */
  name: string
}

/**
 * Server SDK methods available in workflow execution context
 */
export interface WorkflowSDK {
  /** Get the current user */
  getCurrentUser: () => WorkflowUser

  /** Get user-scoped connection */
  getUserConnection: () => Connection | undefined

  /** Get organization-scoped connection */
  getOrganizationConnection: () => Connection | undefined

  /** Make HTTP requests */
  fetch: (options: ServerSDKFetchOptions) => Promise<ServerSDKFetchResponse>

  /** Get a workflow variable by name */
  getVariable: <T = unknown>(name: string) => T

  /** Set a workflow variable */
  setVariable: <T = unknown>(name: string, value: T) => void

  /** Log messages during execution */
  log: (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void

  /** Get organization setting value */
  getOrganizationSetting: <T = unknown>(key: string) => Promise<T | undefined>

  /** Get user setting value */
  getUserSetting: <T = unknown>(key: string) => Promise<T | undefined>
}

/**
 * HTTP fetch options for SDK fetch method
 */
export interface ServerSDKFetchOptions {
  /** Request URL */
  url: string
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** Request headers */
  headers?: Record<string, string>
  /** Request body */
  body?: any
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * HTTP fetch response from SDK fetch method
 */
export interface ServerSDKFetchResponse {
  /** Response status code */
  status: number
  /** Response data */
  data: any
  /** Response headers */
  headers: Record<string, string>
}

/**
 * Execution context provided to workflow block execute functions
 */
export interface WorkflowExecutionContext {
  /** Current workflow ID */
  workflowId: string

  /** Current execution ID */
  executionId: string

  /** Current node ID */
  nodeId: string

  /** Variables from previous nodes (already interpolated) */
  variables: Record<string, any>

  /** Current user information */
  user: WorkflowUser

  /** Current organization information */
  organization: WorkflowOrganization

  /** SDK methods for workflow execution */
  sdk: WorkflowSDK
}

/**
 * Workflow schema definition with input and output fields
 */
export interface WorkflowSchema {
  /** Input field definitions */
  inputs: Record<string, any>
  /** Output field definitions */
  outputs: Record<string, any>
}

/**
 * Configuration options for workflow blocks
 */
export interface WorkflowBlockConfig {
  /** Execution timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Number of retry attempts on failure (default: 0) */
  retries?: number
  /** Whether this block requires an app connection */
  requiresConnection?: boolean
}

/**
 * Props provided to workflow node components
 */
export interface WorkflowNodeProps<TSchema extends WorkflowSchema = WorkflowSchema> {
  /** Node data from workflow */
  data?: InferWorkflowInput<TSchema>
  /** Node ID */
  nodeId?: string
  /** Node status */
  status?: 'idle' | 'running' | 'success' | 'error'
  /** Last execution result */
  lastRun?: {
    startedAt: string
    completedAt: string
    duration: number
    output: InferWorkflowOutput<TSchema>
    error?: {
      code: string
      message: string
    }
  }
}

/**
 * Props provided to workflow panel components
 */
export interface WorkflowPanelProps<TSchema extends WorkflowSchema = WorkflowSchema> {
  /** Node data from workflow */
  data?: InferWorkflowInput<TSchema>
  /** Node ID */
  nodeId?: string
  /** Callback to update node data */
  onDataChange?: (data: InferWorkflowInput<TSchema>) => void
}

/**
 * Execute function signature for workflow blocks.
 *
 * Context is no longer passed as a parameter - use SDK imports instead:
 * - import { getUserConnection } from '@auxx/sdk/server'
 * - import { getCurrentUser } from '@auxx/sdk/server'
 *
 * The runtime injects global.AUXX_SERVER_SDK before execution.
 */
export type WorkflowExecuteFunction<TSchema extends WorkflowSchema = WorkflowSchema> = (
  input: InferWorkflowInput<TSchema>
) => Promise<InferWorkflowOutput<TSchema>>

/**
 * Workflow block definition
 */
export interface WorkflowBlock<TSchema extends WorkflowSchema = WorkflowSchema> {
  /** Unique identifier for the block */
  id: string

  /** Display label */
  label: string

  /** Block description */
  description?: string

  /** Block category for organization */
  category?: WorkflowCategory

  /** Icon (emoji or component) */
  icon?: string | ComponentType

  /** Icon color (hex color) */
  color?: string

  /** Input/output schema */
  schema: TSchema

  /** Node visualization component (rendered on canvas) */
  node?: ComponentType<WorkflowNodeProps<TSchema>>

  /** Panel configuration component */
  panel?: ComponentType<WorkflowPanelProps<TSchema>>

  /** Server-side execution function */
  execute: WorkflowExecuteFunction<TSchema>

  /** Block configuration */
  config?: WorkflowBlockConfig
}

/**
 * Workflow trigger definition (same structure as block, but initiates workflows)
 */
export interface WorkflowTrigger<TSchema extends WorkflowSchema = WorkflowSchema> {
  /** Unique identifier for the trigger */
  id: string

  /** Display label */
  label: string

  /** Trigger description */
  description?: string

  /** Trigger category for organization */
  category?: WorkflowCategory

  /** Icon (emoji or component) */
  icon?: string | ComponentType

  /** Icon color (hex color) */
  color?: string

  /** Input/output schema */
  schema: TSchema

  /** Node visualization component */
  node?: ComponentType<WorkflowNodeProps<TSchema>>

  /** Panel configuration component */
  panel?: ComponentType<WorkflowPanelProps<TSchema>>

  /** Server-side execution function */
  execute: WorkflowExecuteFunction<TSchema>

  /** Trigger configuration */
  config?: WorkflowBlockConfig
}

/**
 * Type inference utilities
 */

/**
 * Infer the TypeScript type from a field node
 * This will be expanded as we implement field nodes
 */
// @ts-ignore - Placeholder type parameter
export type InferFieldType<T> = any // Placeholder - will be refined with field node types

/**
 * Infer the input type from a workflow schema
 */
export type InferWorkflowInput<T extends WorkflowSchema> = {
  [K in keyof T['inputs']]: InferFieldType<T['inputs'][K]>
}

/**
 * Infer the output type from a workflow schema
 */
export type InferWorkflowOutput<T extends WorkflowSchema> = {
  [K in keyof T['outputs']]: InferFieldType<T['outputs'][K]>
}
