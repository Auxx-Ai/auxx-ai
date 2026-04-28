// packages/lib/src/ai/clients/base/types.ts

// ===== CORE TYPE DEFINITIONS =====

export interface UsageMetrics {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ModelValidationResult {
  isValid: boolean
  error?: string
  model?: string
}

export interface ModelCapabilities {
  maxTokens: number
  supportsStreaming: boolean
  supportsTools: boolean
  supportedContentTypes: ContentType[]
  costPerToken?: {
    input: number
    output: number
  }
  rateLimit?: {
    requestsPerMinute: number
    tokensPerMinute: number
  }
}

export type ContentType = 'text' | 'image' | 'audio' | 'file'

export interface MultiModalContent {
  type: ContentType
  data: string
  metadata?: {
    duration?: number // for audio
    detail?: 'high' | 'low' // for images
    format?: string
    filename?: string // original filename (e.g. 'invoice.pdf')
    mimeType?: string // e.g. 'application/pdf', 'text/csv'
    size?: number // bytes, for validation and token estimation
    [key: string]: any
  }
}

export interface OperationContext {
  operation: string
  model?: string
  organizationId?: string
  userId?: string
  [key: string]: any
}

// ===== CLIENT CONFIGURATION =====

export interface ClientConfig {
  retries: {
    maxAttempts: number
    backoffStrategy: 'exponential' | 'linear' | 'fixed'
    baseDelay: number
    maxDelay: number
  }
  circuitBreaker: {
    failureThreshold: number
    resetTimeout: number
    monitoringPeriod: number
  }
  timeouts: {
    request: number
    connection: number
  }
}

// ===== LLM TYPES =====

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | MultiModalContent[] | null
  tool_call_id?: string
  /** Tool calls made by an assistant message (required by OpenAI for multi-turn tool use) */
  tool_calls?: ToolCall[]
  /** Reasoning content from thinking-enabled models (DeepSeek, Kimi, Qwen) */
  reasoning_content?: string
}

export interface Tool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, any>
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string | Record<string, any>
  }
}

export interface ModelParameters {
  temperature?: number
  max_tokens?: number
  top_p?: number
  top_k?: number
  frequency_penalty?: number
  presence_penalty?: number
  stop?: string | string[]
  [key: string]: any
}

export interface LLMInvokeParams {
  model: string
  messages: Message[]
  parameters?: ModelParameters
  tools?: Tool[]
  stop?: string[]
  user?: string
  stream?: boolean
  response_format?: string | { type: string; json_schema?: any }
  json_schema?: string
  // OpenAI specific
  max_completion_tokens?: number
  block_as_stream?: boolean
}

export interface LLMResponse {
  id?: string
  model: string
  content: string
  tool_calls?: ToolCall[]
  usage: UsageMetrics
  /** Reasoning content from thinking-enabled models (DeepSeek, Kimi, Qwen) */
  reasoning_content?: string
  metadata?: {
    systemFingerprint?: string
    [key: string]: any
  }
}

export interface LLMStreamChunk {
  id: string
  model: string
  content: string
  delta: string
  finishReason?: string
  toolCalls?: ToolCall[]
  usage?: UsageMetrics
  /** Reasoning content delta from thinking-enabled models (DeepSeek, Kimi, Qwen) */
  reasoning_delta?: string
  metadata?: {
    chunkIndex: number
    totalLength: number
    systemFingerprint?: string
    [key: string]: any
  }
}

export interface LLMStreamResult {
  model: string
  content: string
  toolCalls: ToolCall[]
  usage: UsageMetrics
  /** Reasoning content from thinking-enabled models (DeepSeek, Kimi, Qwen) */
  reasoning_content?: string
  metadata?: {
    chunkCount: number
    totalLength: number
    streamingCompleted: boolean
    [key: string]: any
  }
}

export interface ProcessedContent {
  messages: Message[]
  tokenCount: number
}

export interface FunctionCall {
  name?: string
  arguments?: string
}

// ===== EMBEDDING TYPES =====

export interface EmbeddingParams {
  text: string | string[]
  model: string
  dimensions?: number
  user?: string
}

export interface EmbeddingResponse {
  embeddings: number[][]
  model: string
  usage: UsageMetrics
}

export interface BatchEmbeddingParams {
  texts: string[]
  model: string
  dimensions?: number
  batchSize?: number
  user?: string
}

export interface BatchEmbeddingResponse {
  embeddings: number[][]
  model: string
  usage: UsageMetrics
  batchInfo: {
    totalBatches: number
    processedTexts: number
  }
}

// ===== SPEECH TO TEXT TYPES =====

export interface TranscribeParams {
  audio: Buffer | string
  model: string
  language?: string
  format?: 'json' | 'text' | 'srt' | 'vtt'
  temperature?: number
  response_format?: string
  user?: string
  /** Original filename — providers use the extension to detect audio format. */
  filename?: string
  /** MIME type of the audio buffer (e.g. 'audio/webm', 'audio/mp4'). */
  mimeType?: string
}

export interface TranscriptSegment {
  id: number
  start: number
  end: number
  text: string
  confidence?: number
}

export interface TranscribeResponse {
  text: string
  language?: string
  segments?: TranscriptSegment[]
  usage: UsageMetrics
}

// ===== MODERATION TYPES =====

export interface ModerationParams {
  text: string | string[]
  model: string
  user?: string
}

export interface ModerationResult {
  flagged: boolean
  categories: Record<string, boolean>
  category_scores: Record<string, number>
}

export interface ModerationResponse {
  results: ModerationResult[]
  model: string
  usage: UsageMetrics
}

// ===== TEXT TO SPEECH TYPES =====

export interface TTSParams {
  text: string
  model: string
  voice: string
  format?: 'mp3' | 'wav' | 'flac' | 'opus'
  speed?: number
  user?: string
}

export interface TTSResponse {
  audio: Buffer
  model: string
  usage: UsageMetrics
  metadata?: {
    format: string
    duration?: number
    [key: string]: any
  }
}

// ===== ERROR TYPES =====

export class StreamingError extends Error {
  constructor(
    message: string,
    public originalError?: any
  ) {
    super(message)
    this.name = 'StreamingError'
  }
}

export class InvalidParameterError extends Error {
  constructor(
    message: string,
    public parameter?: string
  ) {
    super(message)
    this.name = 'InvalidParameterError'
  }
}

// ===== PROCESSED TYPES FOR OPENAI =====

export interface ProcessedLLMParams extends LLMInvokeParams {
  // OpenAI specific processed params
  max_completion_tokens?: number
  block_as_stream?: boolean
}

// ===== DEFAULT CONFIG =====

export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  retries: {
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 10000,
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    monitoringPeriod: 300000, // 5 minutes
  },
  timeouts: {
    request: 120000, // 2 minutes
    connection: 30000, // 30 seconds
  },
}
