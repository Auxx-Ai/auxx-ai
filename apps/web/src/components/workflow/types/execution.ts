// apps/web/src/components/workflow/types/execution.ts

/**
 * System context provided to all node executions
 */
export interface SystemContext {
  workflow_id: string
  workflowRunId: string
  app_id: string
  query?: string
  files?: any[]
  conversation_id?: string
  user_id?: string
}

/**
 * Execution context passed to node executors
 */
export interface ExecutionContext {
  nodeId: string
  workflowId: string
  executionId: string
  inputs: Record<string, any>
  variables: Record<string, any>
  sys: SystemContext
}

/**
 * Result returned by node execution
 */
export interface ExecutionResult<T = any> {
  status: 'success' | 'error' | 'skip'
  outputs?: T
  error?: Error
  metadata?: Record<string, any>
  duration: number
}

/**
 * Service container for node access to APIs
 */
export interface ServiceContainer {
  db: any // Database access
  api: any // tRPC API access
  email: any // Email service
  ai: any // AI service
  // Add more services as needed
}
