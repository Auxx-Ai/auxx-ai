// apps/lambda/src/types/workflow.ts

/**
 * Type definitions for workflow block execution in Lambda
 */

import type { RuntimeContext } from '../types.ts'

/**
 * Workflow execution input passed to workflow blocks
 */
export interface WorkflowExecutionInput {
  /** Input data from the workflow node */
  data: Record<string, any>

  /** Workflow execution context */
  context: {
    workflowId: string
    executionId: string
    nodeId: string
    variables: Record<string, any>
    user: {
      id: string
      email: string
      name: string
    }
    organization: {
      id: string
      handle: string
      name: string
    }
  }

  /** SDK methods injected by platform */
  sdk: WorkflowSDK
}

/**
 * Workflow execution output returned by workflow blocks
 */
export interface WorkflowExecutionOutput {
  /** Output data from block execution */
  data: any

  /** Optional execution metadata */
  metadata?: {
    /** Custom logs from block execution */
    logs?: WorkflowLog[]
    /** Execution duration in ms */
    duration?: number
    /** Any additional metadata */
    [key: string]: any
  }
}

/**
 * Workflow SDK interface available to workflow blocks
 */
export interface WorkflowSDK {
  /** Get workflow variable value */
  getVariable: (name: string) => any

  /** Set workflow variable value */
  setVariable: (name: string, value: any) => void

  /** Get environment variable */
  getEnvironmentVariable: (name: string) => any

  /** Get system variable */
  getSystemVariable: (name: string) => any

  /** Get trigger data */
  getTriggerData: () => Record<string, any> | undefined

  /** Get specific field from a previous node's output */
  getNodeOutput: (nodeId: string, fieldName: string) => any

  /** Get entire output object from a previous node */
  getNodeOutputs: (nodeId: string) => Record<string, any> | undefined

  /** Log message with level */
  log: (level: 'info' | 'warn' | 'error', message: string, data?: any) => void

  /** Optional cache methods */
  cache?: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any, ttl?: number) => Promise<void>
    delete: (key: string) => Promise<void>
  }

  /** Get current user */
  getCurrentUser: () => {
    id: string
    email?: string | null
    name?: string | null
    avatar?: string
    role?: string
  }

  /** Make HTTP request */
  fetch: (options: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
    timeout?: number
  }) => Promise<{
    status: number
    headers: Record<string, string>
    data: unknown
  }>

  /** Get user connection */
  getUserConnection: () => Connection | undefined

  /** Get organization connection */
  getOrganizationConnection: () => Connection | undefined

  /** Get organization setting */
  getOrganizationSetting: (key: string) => Promise<any | undefined>

  /** Get all organization settings */
  getOrganizationSettings: () => Promise<Record<string, any>>

  /** Set organization setting */
  setOrganizationSetting: (key: string, value: any) => Promise<void>

  /** Set multiple organization settings */
  setOrganizationSettings: (settings: Record<string, any>) => Promise<void>
}

/**
 * Connection data for external services
 */
export interface Connection {
  id: string
  type: 'oauth2-code' | 'secret'
  value: string
  metadata?: Record<string, any>
  expiresAt?: Date
}

/**
 * Workflow log entry
 */
export interface WorkflowLog {
  level: 'info' | 'warn' | 'error'
  message: string
  data?: any
  timestamp: number
}

/**
 * Workflow execution context (extends RuntimeContext)
 */
export interface WorkflowExecutionContext extends RuntimeContext {
  workflowId: string
  executionId: string
  nodeId: string
  variables: Record<string, any>
  environmentVariables?: Record<string, any>
  systemVariables?: Record<string, any>
  triggerData?: Record<string, any>
  nodeOutputs?: Record<string, Record<string, any>>
  cache?: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any, ttl?: number) => Promise<void>
    delete: (key: string) => Promise<void>
  }
}

/**
 * Workflow block definition structure
 */
export interface WorkflowBlock {
  id: string
  name: string
  description: string
  category: string
  inputs: WorkflowBlockInput[]
  outputs: WorkflowBlockOutput[]
  execute: (input: WorkflowExecutionInput) => Promise<WorkflowExecutionOutput>
}

/**
 * Workflow block input definition
 */
export interface WorkflowBlockInput {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'text' | 'json'
  required?: boolean
  defaultValue?: any
  placeholder?: string
  description?: string
  options?: Array<{ label: string; value: any }>
}

/**
 * Workflow block output definition
 */
export interface WorkflowBlockOutput {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
}
