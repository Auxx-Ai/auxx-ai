// packages/lib/src/workflows/types.ts
// Re-export workflow engine types
export * from '../workflow-engine/core/types'

import {
  NodeTriggerSource as NodeTriggerSourceEnum,
  WorkflowRunStatus as WorkflowRunStatusEnum,
  WorkflowTriggerSource as WorkflowTriggerSourceEnum,
} from '@auxx/database/enums'
import type {
  UserEntity as User,
  WorkflowEntity as Workflow,
  WorkflowAppEntity as WorkflowApp,
  WorkflowNodeExecutionEntity as WorkflowNodeExecution,
  WorkflowRunEntity as WorkflowRun,
  WorkflowRunStatus,
  WorkflowTriggerSource,
} from '@auxx/database/types'
// Import from workflow engine
import type { WorkflowTriggerType } from '../workflow-engine/core/types'

// Error handling types
export interface WorkflowExecutionError {
  code: string
  message: string
  statusCode?: number
}
export type ErrorHandler = (error: WorkflowExecutionError) => never
// Service-specific types
export interface WorkflowFilter {
  enabled?: boolean
  triggerType?: WorkflowTriggerType
  search?: string
  limit: number
  offset: number
}
export interface WorkflowCreateInput {
  name: string
  description?: string
  enabled: boolean
  icon?: { iconId: string; color: string }
  // Template-related fields (optional, used when creating from template)
  graph?: WorkflowGraph
  triggerType?: WorkflowTriggerType
  entityDefinitionId?: string // NEW: replaces triggerConfig
  envVars?: EnvironmentVariable[]
  variables?: any[]
}
export interface WorkflowUpdateInput {
  id: string
  name?: string
  description?: string
  enabled?: boolean
  triggerType?: WorkflowTriggerType | null
  entityDefinitionId?: string | null // NEW: replaces triggerConfig
  graph?: WorkflowGraph
  envVars?: EnvironmentVariable[]
  variables?: any[]

  // Access settings
  webEnabled?: boolean
  apiEnabled?: boolean
  accessMode?: 'public' | 'organization'
  icon?: { iconId: string; color: string }
  config?: {
    title?: string
    description?: string
    logoUrl?: string
    brandName?: string
    hideBranding?: boolean
    showWorkflowPreview?: boolean
    showInputForm?: boolean
    submitButtonText?: string
    successMessage?: string
    maxConcurrentRuns?: number
  }
  rateLimit?: {
    enabled: boolean
    maxRequests: number
    windowMs: number
    perUser?: boolean
  }
}
export interface WorkflowGraph {
  nodes: any[]
  edges: any[]
  viewport?: {
    x: number
    y: number
    zoom: number
  }
}
export interface EnvironmentVariable {
  id: string
  name: string
  value?: any // Make optional to match incoming data
  type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
}
export interface NodeInput {
  variableId: string
  value?: any // Make optional to match incoming data
  nodeId?: string
  type?: string
  lastUpdated?: number
}
export interface TestMessage {
  id?: string
  subject: string
  textPlain: string
  from: {
    identifier: string
    name: string
  }
  isInbound?: boolean
}
export interface WorkflowTestInput {
  workflowId: string
  testData: {
    message: TestMessage
    variables?: Record<string, any>
  }
  options?: {
    dryRun?: boolean
    debug?: boolean
  }
}
export interface TestResult {
  success: boolean
  result: any
}
export interface WorkflowStats {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  successRate: number
  averageExecutionTime: number
  recentExecutions: WorkflowRun[]
  timeRange: string
}
// Time-series data point for charts
export interface TimeSeriesDataPoint {
  timestamp: Date
  date: string // formatted date for x-axis
  value: number
}
// Detailed analytics with time-series data
export interface WorkflowDetailedStats {
  workflowId: string
  timeRange: DetailedTimeRange
  dateRange: {
    from: Date
    to: Date
  }
  executionsOverTime: TimeSeriesDataPoint[]
  tokenUsageOverTime: TimeSeriesDataPoint[]
  successRateOverTime: TimeSeriesDataPoint[]
  avgExecutionTimeOverTime: TimeSeriesDataPoint[]
  summary: {
    totalExecutions: number
    totalTokens: number
    avgSuccessRate: number
    avgExecutionTime: number
    periodComparison?: {
      executionsChange: number
      tokensChange: number
      successRateChange: number
      executionTimeChange: number
    }
  }
}
// Extended time range to support frontend values
export type DetailedTimeRange =
  | 'today'
  | 'last7days'
  | 'last4weeks'
  | 'last3months'
  | 'last12months'
  | 'monthToDate'
  | 'quarterToDate'
  | 'yearToDate'
  | 'allTime'
  | 'custom'
// For custom date ranges
export interface CustomDateRange {
  from: Date
  to: Date
}
export interface WorkflowWithDetails extends WorkflowApp {
  publishedWorkflow?: Workflow
  draftWorkflow?: Workflow
  workflows?: Pick<Workflow, 'id' | 'version' | 'name' | 'createdAt' | 'enabled'>[]
  createdBy?: Pick<User, 'id' | 'name' | 'email'>
  _count?: {
    workflows: number
  }
}
export interface WorkflowListResult {
  workflows: any[] // Transformed workflow format
  total: number
  hasMore: boolean
}
export interface WorkflowVersion {
  id: string
  name: string
  version: number
  createdAt: Date
  enabled: boolean
  title?: string // UI compatibility
  isPublished?: boolean // UI compatibility
  isDraft?: boolean // UI compatibility
}
export type TimeRange = '1h' | '24h' | '7d' | '30d' | '90d'
// Basic workflow run type for lightweight data transfer
export interface BasicWorkflowRun {
  id: string
  status: WorkflowRunStatus
  createdAt: Date
  workflowAppId: string
  sequenceNumber: number
  elapsedTime: number | null
  triggeredFrom: WorkflowTriggerSource
  totalTokens: number | null
  totalSteps: number | null
}
export type ProcessingMode = 'RULES_ONLY' | 'WORKFLOWS_ONLY' | 'HYBRID'
// Workflow Execution Types
export interface RunWorkflowParams {
  workflowAppId: string
  workflowId: string
  inputs: Record<string, any>
  mode: 'test' | 'production'
  userId: string
  organizationId: string
  userEmail?: string
  userName?: string
  organizationName?: string
}
// NodeInput interface moved here from workflow execution types
export interface RunNodeParams {
  workflowAppId: string
  workflowId: string
  nodeId: string
  inputs: NodeInput[]
  userId: string
  organizationId: string
}
export interface WorkflowEvent {
  event: string
  workflowRunId: string
  task_id?: string
  data: any
}
export interface ListRunOptions {
  limit?: number
  cursor?: string
  status?: WorkflowRunStatus
  startDate?: Date
  endDate?: Date
}
export interface PaginatedResult<T> {
  items: T[]
  nextCursor: string | null
  hasNextPage: boolean
}
export interface WorkflowRunWithDetails extends WorkflowRun {
  workflow?: Workflow
  workflowApp?: WorkflowApp
  user?: User
  nodeExecutions?: WorkflowNodeExecution[]
}
// Re-export database types that services will use
export type { Workflow, WorkflowApp, WorkflowRun, WorkflowNodeExecution }
// Re-export enums as values

export {
  WorkflowRunStatusEnum as WorkflowRunStatus,
  WorkflowTriggerSourceEnum as WorkflowTriggerSource,
  NodeTriggerSourceEnum as NodeTriggerSource,
}
