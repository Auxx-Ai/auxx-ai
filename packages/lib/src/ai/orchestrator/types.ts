// packages/lib/src/ai/orchestrator/types.ts

import type {
  LLMResponse,
  LLMStreamChunk,
  Message,
  ModelParameters,
  Tool,
  ToolCall,
  UsageMetrics,
} from '../clients/base/types'

// ===== ORCHESTRATOR REQUEST/RESPONSE TYPES =====

export interface LLMInvocationRequest {
  // Core parameters
  model: string
  provider: string
  messages: Message[]
  parameters?: ModelParameters

  // Context
  organizationId: string
  userId: string
  context?: {
    source: string
    workflowId?: string
    nodeId?: string
    sessionId?: string
    [key: string]: any
  }

  // Features
  tools?: Tool[]
  streaming?: {
    enabled: boolean
    chunkCallback?: (chunk: LLMStreamChunk) => Promise<void>
  }
  structuredOutput?: {
    enabled: boolean
    schema?: Record<string, any>
  }
  multiModal?: {
    enabled: boolean
    contentTypes?: string[]
  }

  // Tool execution
  toolExecutor?: ToolExecutor
  callbacks?: AICallbacks
}

export interface LLMInvocationResponse extends LLMResponse {
  provider: string
  tool_results?: ToolExecutionResult[]
  structured_output?: Record<string, any>
}

// ===== CALLBACK TYPES =====

export interface AICallbacks {
  beforeInvoke?: (context: any) => Promise<void>
  onChunk?: (chunk: LLMStreamChunk) => Promise<void>
  afterInvoke?: (response: LLMResponse) => Promise<void>
  onError?: (error: Error) => Promise<void>
  onToolCall?: (toolCall: ToolCall) => Promise<void>
  onToolResult?: (result: ToolExecutionResult) => Promise<void>
}

// ===== TOOL EXECUTION TYPES =====

export interface ToolExecutor {
  executeTools(toolCalls: ToolCall[], context?: any): Promise<ToolExecutionResult[]>
}

export interface ToolExecutionResult {
  toolCallId: string
  toolName: string
  success: boolean
  output: Record<string, any>
  error?: string
  executionTime?: number
  metadata?: Record<string, any>
}

// ===== USAGE TRACKING TYPES =====

/** Credential source type for tracking where credentials came from */
export type CredentialSourceType = 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED'

/** Provider type for tracking system vs custom credentials */
export type ProviderTypeValue = 'SYSTEM' | 'CUSTOM'

/** Source of AI usage for tracking purposes */
export type UsageSource = 'compose' | 'workflow' | 'dataset' | 'chat' | 'other'

export interface UsageTrackingRequest {
  organizationId: string
  userId: string
  provider: string
  model: string
  usage: UsageMetrics
  context?: string
  timestamp: Date
  metadata?: Record<string, any>
  /** Which credential type was used: SYSTEM (platform-provided) or CUSTOM (user-provided API key) */
  providerType?: ProviderTypeValue
  /** Detailed credential source: SYSTEM, CUSTOM, MODEL_SPECIFIC, or LOAD_BALANCED */
  credentialSource?: CredentialSourceType
  /** Credits consumed for this request (default 1 for system providers) */
  creditsUsed?: number
  /** Source of the AI usage: compose, workflow, dataset, chat, other */
  source?: UsageSource
  /** ID of the source entity (workflow ID, dataset ID, etc.) if applicable */
  sourceId?: string
}

export interface UsageTrackingService {
  trackUsage(request: UsageTrackingRequest): Promise<void>
  checkQuotaAvailable?(
    organizationId: string,
    provider: string,
    estimatedTokens: number
  ): Promise<{
    available: boolean
    reason?: string
  }>
}

// ===== BATCH OPERATION TYPES =====

export interface BatchLLMRequest {
  requests: LLMInvocationRequest[]
  batchOptions?: {
    maxConcurrency?: number
    failFast?: boolean
    retryFailures?: boolean
  }
}

export interface BatchLLMResponse {
  results: Array<{
    success: boolean
    response?: LLMInvocationResponse
    error?: Error
    requestIndex: number
  }>
  metadata: {
    totalRequests: number
    successfulRequests: number
    failedRequests: number
    totalExecutionTime: number
  }
}

// ===== STREAM TYPES =====

export interface StreamConfiguration {
  enabled: boolean
  bufferSize?: number
  flushInterval?: number
  includeUsage?: boolean
  onChunk?: (chunk: LLMStreamChunk) => Promise<void>
  onComplete?: (result: any) => Promise<void>
  onError?: (error: Error) => Promise<void>
}

// ===== ORCHESTRATOR CONFIGURATION =====

export interface OrchestratorConfig {
  defaultProvider?: string
  defaultModel?: string
  enableUsageTracking?: boolean
  enableQuotaEnforcement?: boolean
  defaultTimeouts?: {
    request?: number
    streaming?: number
  }
  retryDefaults?: {
    maxAttempts?: number
    backoffStrategy?: 'exponential' | 'linear' | 'fixed'
  }
}

// ===== ERROR TYPES =====

export class OrchestratorError extends Error {
  public readonly operation: string
  public readonly provider?: string
  public readonly model?: string
  public readonly originalError?: Error

  constructor(
    message: string,
    operation: string,
    provider?: string,
    model?: string,
    originalError?: Error
  ) {
    super(message)
    this.name = 'OrchestratorError'
    this.operation = operation
    this.provider = provider
    this.model = model
    this.originalError = originalError
  }
}

export class ToolExecutionError extends Error {
  public readonly toolName: string
  public readonly toolCallId: string
  public readonly originalError?: Error

  constructor(message: string, toolName: string, toolCallId: string, originalError?: Error) {
    super(message)
    this.name = 'ToolExecutionError'
    this.toolName = toolName
    this.toolCallId = toolCallId
    this.originalError = originalError
  }
}

export class QuotaExceededError extends Error {
  public readonly provider: string
  public readonly organizationId: string
  public readonly estimatedTokens: number

  constructor(message: string, provider: string, organizationId: string, estimatedTokens: number) {
    super(message)
    this.name = 'QuotaExceededError'
    this.provider = provider
    this.organizationId = organizationId
    this.estimatedTokens = estimatedTokens
  }
}
