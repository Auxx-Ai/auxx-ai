// packages/lib/src/ai/index.ts

// ===== MAIN ORCHESTRATOR =====
export { LLMOrchestrator } from './orchestrator'
export type {
  LLMInvocationRequest,
  LLMInvocationResponse,
  AICallbacks,
  ToolExecutor,
  ToolExecutionResult,
  UsageTrackingRequest,
  BatchLLMRequest,
  BatchLLMResponse,
  OrchestratorConfig,
} from './orchestrator'

// ===== SPECIALIZED CLIENTS (Base Classes) =====
export {
  BaseSpecializedClient,
  LLMClient,
  TextEmbeddingClient,
  Speech2TextClient,
  ModerationClient,
  TTSClient,
} from './clients/base'

// ===== CLIENT UTILITIES =====
export { RetryManager, CircuitBreaker, CircuitState, TokenCalculator } from './clients/utils'

// ===== SPECIALIZED CLIENT TYPES =====
export type {
  ClientConfig,
  LLMInvokeParams,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamResult,
  EmbeddingParams,
  EmbeddingResponse,
  TranscribeParams,
  TranscribeResponse,
  ModerationParams,
  ModerationResponse,
  TTSParams,
  TTSResponse,
  UsageMetrics,
  ModelCapabilities as SpecializedModelCapabilities,
  MultiModalContent,
  Message,
  Tool,
  ToolCall,
  ModelParameters,
  OperationContext,
  DEFAULT_CLIENT_CONFIG,
} from './clients/base'

// ===== PROVIDER SYSTEM (Existing) =====
export { ProviderClient } from './providers/base/provider-client'
export { ProviderRegistry } from './providers/provider-registry'
export { ProviderManager } from './providers/provider-manager'
export { ProviderConfigurationService } from './providers/provider-configuration-service'
export { SystemModelService, type SystemModelDefaultEntity } from './providers/system-model-service'

// ===== PROVIDER TYPES (Existing) =====
export type {
  ModelType,
  ProviderType,
  ModelCapabilities,
  ProviderCapabilities,
  ProviderData,
  ModelData,
  ProviderConfiguration,
  CredentialFormField,
  ProviderCredentials,
} from './providers/types'

// ===== OPENAI SPECIALIZED CLIENTS =====
export {
  OpenAILLMClient,
  OpenAITextEmbeddingClient,
  OpenAISpeech2TextClient,
  OpenAIModerationClient,
  OpenAITTSClient,
} from './providers/openai/specialized-clients'

// ===== EXISTING PROVIDER CLIENTS =====
export { OpenAIClient } from './providers/openai/openai-client'
export { AnthropicClient } from './providers/anthropic/anthropic-client'
export { GoogleClient } from './providers/google/google-client'
export { GroqClient } from './providers/groq/groq-client'
export { DeepSeekClient } from './providers/deepseek/deepseek-client'

// ===== USAGE TRACKING =====
export {
  UsageTrackingService,
  type UsageDayEntry,
  type UsageStatsByPeriodResponse,
  type UsageSource,
} from './usage/usage-tracking-service'

// ===== QUOTA MANAGEMENT =====
export { QuotaService } from './quota'

// ===== ERROR TYPES =====
export { QuotaExceededError } from './errors/quota-errors'
export type { OrchestratorError, ToolExecutionError } from './orchestrator'

export type { StreamingError, InvalidParameterError } from './clients/base/types'
