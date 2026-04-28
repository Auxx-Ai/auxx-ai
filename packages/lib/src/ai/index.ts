// packages/lib/src/ai/index.ts

// ===== SPECIALIZED CLIENT TYPES =====
export type {
  ClientConfig,
  DEFAULT_CLIENT_CONFIG,
  EmbeddingParams,
  EmbeddingResponse,
  LLMInvokeParams,
  LLMResponse,
  LLMStreamChunk,
  LLMStreamResult,
  Message,
  ModelCapabilities as SpecializedModelCapabilities,
  ModelParameters,
  ModerationParams,
  ModerationResponse,
  MultiModalContent,
  OperationContext,
  Tool,
  ToolCall,
  TranscribeParams,
  TranscribeResponse,
  TTSParams,
  TTSResponse,
  UsageMetrics,
} from './clients/base'
// ===== SPECIALIZED CLIENTS (Base Classes) =====
export {
  BaseSpecializedClient,
  LLMClient,
  ModerationClient,
  Speech2TextClient,
  TextEmbeddingClient,
  TTSClient,
} from './clients/base'
export type { InvalidParameterError, StreamingError } from './clients/base/types'

// ===== CLIENT UTILITIES =====
export { CircuitBreaker, CircuitState, RetryManager, TokenCalculator } from './clients/utils'
// ===== ERROR TYPES =====
export { QuotaExceededError } from './errors/quota-errors'
export type {
  AICallbacks,
  BatchLLMRequest,
  BatchLLMResponse,
  LLMInvocationRequest,
  LLMInvocationResponse,
  OrchestratorConfig,
  OrchestratorError,
  Speech2TextInvocationRequest,
  Speech2TextInvocationResponse,
  ToolExecutionError,
  ToolExecutionResult,
  ToolExecutor,
  UsageTrackingRequest,
} from './orchestrator'
// ===== MAIN ORCHESTRATOR =====
export { LLMOrchestrator, Speech2TextOrchestrator } from './orchestrator'
export { AnthropicClient } from './providers/anthropic/anthropic-client'
// ===== PROVIDER SYSTEM (Existing) =====
export { ProviderClient } from './providers/base/provider-client'
export { DeepSeekClient } from './providers/deepseek/deepseek-client'
export { GoogleClient } from './providers/google/google-client'
export { GroqClient } from './providers/groq/groq-client'
export { KimiClient } from './providers/kimi/kimi-client'
// ===== EXISTING PROVIDER CLIENTS =====
export { OpenAIClient } from './providers/openai/openai-client'
// ===== OPENAI SPECIALIZED CLIENTS =====
export {
  OpenAILLMClient,
  OpenAIModerationClient,
  OpenAISpeech2TextClient,
  OpenAITextEmbeddingClient,
  OpenAITTSClient,
} from './providers/openai/specialized-clients'
export { ProviderConfigurationService } from './providers/provider-configuration-service'
export { ProviderManager } from './providers/provider-manager'
export { ProviderRegistry } from './providers/provider-registry'
export { QwenClient } from './providers/qwen/qwen-client'
export { type SystemModelDefaultEntity, SystemModelService } from './providers/system-model-service'
// ===== PROVIDER TYPES (Existing) =====
export type {
  CredentialFormField,
  ModelCapabilities,
  ModelData,
  ModelType,
  ProviderCapabilities,
  ProviderConfiguration,
  ProviderCredentials,
  ProviderData,
  ProviderType,
} from './providers/types'
// ===== QUOTA MANAGEMENT =====
export { QuotaService } from './quota'
// ===== USAGE TRACKING =====
export {
  type UsageDayEntry,
  type UsageSource,
  type UsageStatsByPeriodResponse,
  UsageTrackingService,
} from './usage/usage-tracking-service'
