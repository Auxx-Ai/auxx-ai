// packages/lib/src/ai/providers/types.ts

// ===== CORE ENUMS =====

export enum ModelType {
  LLM = 'llm',
  TEXT_EMBEDDING = 'text-embedding',
  RERANK = 'rerank',
  TTS = 'tts',
  SPEECH2TEXT = 'speech2text',
  MODERATION = 'moderation',
  VISION = 'vision',
}

export enum ProviderType {
  SYSTEM = 'SYSTEM',
  CUSTOM = 'CUSTOM',
}

export enum ProviderQuotaType {
  PAID = 'paid',
  FREE = 'free',
  TRIAL = 'trial',
}

export enum QuotaUnit {
  TIMES = 'times',
  TOKENS = 'tokens',
  CREDITS = 'credits',
}

export enum ModelStatus {
  ACTIVE = 'active',
  NO_CONFIGURE = 'no-configure',
  QUOTA_EXCEEDED = 'quota-exceeded',
  NO_PERMISSION = 'no-permission',
  DISABLED = 'disabled',
  DEPRECATED = 'deprecated',
  RETIRED = 'retired',
}

export enum FetchFrom {
  PREDEFINED_MODEL = 'predefined-model',
  CUSTOMIZABLE_MODEL = 'customizable-model',
}

export enum FormType {
  SECRET_INPUT = 'secret-input',
  TEXT_INPUT = 'text-input',
  SELECT = 'select',
  BOOLEAN = 'boolean',
}

// ===== CORE INTERFACES =====

export interface ModelCapabilities {
  provider: string
  modelId: string // The model identifier (e.g., "gpt-4o", "my-custom-llama")
  displayName: string
  icon: string
  color: string
  contextLength: number
  maxTokens: number
  modelType: ModelType
  fetchFrom: FetchFrom // Distinguish predefined vs customizable models
  features: string[]
  supports: {
    streaming: boolean
    structured: boolean
    vision: boolean
    toolCalling: boolean
    systemMessages: boolean
    fileInput: boolean
  }
  costPer1kTokens?: { input: number; output: number }
  deprecated?: boolean
  retired?: boolean
  replacement?: string
  releaseDate?: string
  description?: string
  parameterRules: ParameterRule[] // Model-specific parameter rules

  // NEW: Parameter restriction configuration for reasoning models
  parameterRestrictions?: {
    /** Parameters that should be removed entirely */
    unsupportedParams?: string[]

    /** Parameters that must use default values only */
    defaultOnlyParams?: Record<string, any>

    /** Parameter name mappings (e.g., max_tokens -> max_completion_tokens) */
    parameterMapping?: Record<string, string>

    /** Parameters that are explicitly supported (if defined, only these are allowed) */
    supportedParams?: string[]

    /** Whether this is a reasoning model with special handling */
    isReasoningModel?: boolean
  }
}

/**
 * Enhanced model data structure that includes complete ModelCapabilities
 * with additional status and configuration information
 */
export interface ModelData extends ModelCapabilities {
  // Additional model state fields:
  // modelId inherited from ModelCapabilities
  // fetchFrom inherited from ModelCapabilities
  enabled: boolean // Model enabled for organization
  status: 'active' | 'disabled' | 'not_configured' | 'deprecated' | 'retired' // Model status
  isDefault: boolean // Is this the default model
  providerType: 'system' | 'custom' // Provider configuration type
  isProviderEnabled: boolean // Is the provider configured and enabled
  config?: Record<string, any> // Model-specific configuration
  loadBalancingEnabled: boolean // Load balancing configuration
  hasModelCredentials?: boolean // Indicates if model has specific credentials
  canConfigureIndependently?: boolean // Can work without provider config
}

type ConfigurateMethod = 'predefined-model' | 'customizable-model'

export interface ProviderCapabilities {
  id?: string // Added for compatibility with factory methods
  displayName: string
  icon: string
  color: string
  supportedModelTypes: ModelType[]
  defaultModel: string
  requiresApiKey: boolean
  toolFormat: 'openai' | 'anthropic' | 'google' | 'custom'
  configurateMethods?: ConfigurateMethod[]

  // NEW: Unified credential schema with scope-based field filtering
  credentialSchema: CredentialFormField[]
  parameterRules?: ParameterRule[] // Provider-wide parameter rules (fallback)
  rateLimits?: {
    requestsPerMinute?: number
    tokensPerMinute?: number
    cacheTtl?: number
  }
  description?: string
  documentationUrl?: string
  setupInstructions?: string
}

/**
 * Clean provider data structure for unified model data response
 */
export interface ProviderData extends ProviderCapabilities {
  provider: string
  label: string
  // configured: boolean
  statusInfo: ProviderStatusInfo // Status information for the provider
  // status: ProviderStatusInfo['status']
  models: ModelData[]
  // supportedModelTypes: string[]
  isDefaultProvider: boolean
}

export interface ProviderConfiguration extends ProviderData {
  organizationId: string
  preferredProviderType: ProviderType
  usingProviderType: ProviderType
  systemConfiguration: SystemConfiguration
  customConfiguration: CustomConfiguration
  modelSettings: ModelSettings[]
}

/**
 * Clean provider configuration without customConfiguration field
 * Useful for responses where custom (sensitive) configuration should be excluded
 */
export interface ProviderConfigurationClean
  extends Omit<ProviderConfiguration, 'customConfiguration'> {}

// export interface ProviderData {
//   provider: string
//   label: string
//   configured: boolean
//   status: ProviderStatusInfo['status']
//   models: ModelData[]
//   supportedModelTypes: string[]
//   isDefaultProvider: boolean
// }

export interface ParameterRule {
  name: string
  type: 'int' | 'float' | 'string' | 'boolean' | 'tag' | 'text'
  label: string
  help?: string
  default: number | string | boolean | string[] | null
  min?: number
  max?: number
  options?: string[]
  precision?: number
  required: boolean
  template?: string // For parameter grouping/categorization
  tagPlaceholder?: string // For tag type parameters
}

/**
 * Interface defining provider status information
 * Contains comprehensive status data for provider configuration validation
 */
export interface ProviderStatusInfo {
  /** Whether the provider is properly configured and ready for use */
  configured: boolean
  /** The type of provider configuration currently in use (system or custom) */
  usingProviderType: ProviderType
  /** Detailed status indicating configuration state and any issues */
  status: 'system_configured' | 'custom_configured' | 'not_configured' | 'quota_exceeded'
  /** Whether the provider has valid credentials for API access */
  hasValidCredentials: boolean
  /** Optional quota information for system providers */
  quotaStatus?: {
    type: string
    used: number
    limit: number
    isValid: boolean
    /** When the quota resets (end of current period) */
    resetsAt?: Date | null
  }
}

export interface CredentialFormField {
  variable: string
  type: 'text-input' | 'secret-input' | 'select' | 'textarea' | 'checkbox'
  label: string
  placeholder?: string
  required: boolean
  default?: string | boolean | null
  maxLength?: number
  options?: { label: string; value: string }[]
  showOn?: { field: string; values: string[] }[] // Conditional display
  helpText?: string
  validation?: { pattern?: string; message?: string }
  // NEW: Enhanced fields for unified credential system
  scope?: 'provider' | 'model' | 'both' // Where this field applies (default: 'provider')
  priority?: 'model-override' | 'provider-only' | 'merge' // How conflicts are resolved (default: 'provider-only')
}

export interface RestrictModel {
  model: string
  baseModelName?: string
  modelType: ModelType
}

export interface QuotaConfiguration {
  quotaType: ProviderQuotaType
  quotaUnit: QuotaUnit
  quotaLimit: number
  quotaUsed: number
  isValid: boolean
  restrictModels: RestrictModel[]
  /** Start of the current quota period */
  quotaPeriodStart?: Date | null
  /** End of the current quota period (when credits reset) */
  quotaPeriodEnd?: Date | null
}

export interface SystemConfiguration {
  enabled: boolean
  currentQuotaType?: ProviderQuotaType
  quotaConfigurations: QuotaConfiguration[]
  credentials?: Record<string, any>
}

export interface CustomProviderConfiguration {
  credentials: Record<string, any>
}

export interface CustomModelConfiguration {
  model: string
  modelType: ModelType
  credentials: Record<string, any>
  parameters?: Record<string, any>
}

export interface CustomConfiguration {
  provider?: CustomProviderConfiguration
  models: CustomModelConfiguration[]
}

export interface ModelLoadBalancingConfiguration {
  id: string
  name: string
  credentials: Record<string, any>
}

export interface ModelSettings {
  model: string
  modelType: ModelType
  enabled: boolean
  loadBalancingConfigs: ModelLoadBalancingConfiguration[]
}

export interface ProviderConfigurations {
  organizationId: string
  configurations: Record<string, ProviderConfiguration>
}

// ===== CREDENTIAL FORM SCHEMAS =====

export interface CredentialFormSchema {
  variable: string
  type: FormType
  required?: boolean
  default?: string | number | boolean
  options?: Array<{ value: string; label: Record<string, string> }>
  label?: Record<string, string> // I18n support
  help?: Record<string, string> // I18n support
  url?: string
  placeholder?: Record<string, string> // I18n support
}

// ===== PROVIDER ENTITIES =====

export interface I18nObject {
  en_US: string
}

export interface SimpleModelProviderEntity {
  provider: string
  label: I18nObject
  iconSmall?: I18nObject
  iconLarge?: I18nObject
  supportedModelTypes: ModelType[]
}

export interface ModelWithProviderEntity {
  model: string
  label: I18nObject
  modelType: ModelType
  features: string[]
  fetchFrom: FetchFrom
  modelProperties: Record<string, any>
  deprecated?: boolean
  retired?: boolean
  replacement?: string
  provider: SimpleModelProviderEntity
  status: ModelStatus
  loadBalancingEnabled?: boolean
}

export interface DefaultModelProviderEntity {
  provider: string
  label: I18nObject
  iconSmall?: I18nObject
  iconLarge?: I18nObject
  supportedModelTypes: ModelType[]
}

export interface DefaultModelEntity {
  model: string
  modelType: ModelType
  provider: DefaultModelProviderEntity
}

// ===== PROVIDER BUNDLE =====

export interface ProviderModelBundle {
  configuration: ProviderConfiguration
  modelTypeInstance: any // AI model instance
}

// ===== VALIDATION & CREDENTIALS =====

export interface CredentialValidationResult {
  isValid: boolean
  error?: string
}

export interface ProviderCredentialsCache {
  organizationId: string
  identityId: string
  cacheType: 'provider' | 'model' | 'load-balancing'
  credentials: Record<string, any>
  expiresAt: Date
}

// ===== DATABASE TYPES =====

export interface ProviderConfigurationRecord {
  id: string
  createdAt: Date
  updatedAt: Date
  organizationId: string
  provider: string
  providerType: string
  credentials?: Record<string, any>
  isEnabled: boolean
  quotaType?: string
}

export interface ModelConfigurationRecord {
  id: string
  createdAt: Date
  updatedAt: Date
  organizationId: string
  provider: string
  model: string
  modelType: string
  credentials?: Record<string, any>
  enabled: boolean
  aiIntegrationId?: string
}

export interface LoadBalancingConfigRecord {
  id: string
  createdAt: Date
  updatedAt: Date
  organizationId: string
  provider: string
  model: string
  modelType: string
  name: string
  credentials?: Record<string, any>
  enabled: boolean
  weight: number
  aiIntegrationId?: string
}

export interface ProviderPreferenceRecord {
  id: string
  createdAt: Date
  updatedAt: Date
  organizationId: string
  provider: string
  preferredType: string
}

// ===== ERROR TYPES =====

export class ProviderConfigurationError extends Error {
  constructor(
    message: string,
    public provider: string,
    public code: string
  ) {
    super(message)
    this.name = 'ProviderConfigurationError'
  }
}

export class CredentialValidationError extends Error {
  constructor(
    message: string,
    public provider: string,
    public credential: string
  ) {
    super(message)
    this.name = 'CredentialValidationError'
  }
}

export class ModelNotFoundError extends Error {
  constructor(
    message: string,
    public provider: string,
    public model: string,
    public modelType: ModelType
  ) {
    super(message)
    this.name = 'ModelNotFoundError'
  }
}

export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public provider: string,
    public quotaType: ProviderQuotaType,
    public used: number,
    public limit: number
  ) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

// ===== UTILITY TYPES =====

export type ProviderCredentials = Record<string, any>
export type ModelCredentials = Record<string, any>
export type EncryptedCredentials = string

export interface HistoryOptions {
  skipHistory?: boolean
}

export interface CacheOptions {
  ttl?: number // Time to live in seconds
  skipCache?: boolean
}

export interface ValidationOptions {
  skipValidation?: boolean
  throwOnError?: boolean
}

/** Credential source type for tracking where credentials came from */
export type CredentialSourceType = 'SYSTEM' | 'CUSTOM' | 'MODEL_SPECIFIC' | 'LOAD_BALANCED'

/** Provider type value for tracking system vs custom credentials */
export type ProviderTypeValue = 'SYSTEM' | 'CUSTOM'

export interface CredentialsResponse {
  credentials: Record<string, any>
  load_balancing?: {
    enabled: boolean
    configs: Array<{
      id: string
      name: string
      credentials: Record<string, any>
      enabled: boolean
      in_cooldown: boolean
      ttl: number
    }>
  }
  /** Which credential type was used: SYSTEM (platform-provided) or CUSTOM (user-provided API key) */
  providerType?: ProviderTypeValue
  /** Detailed credential source: SYSTEM, CUSTOM, MODEL_SPECIFIC, or LOAD_BALANCED */
  credentialSource?: CredentialSourceType
}

// ===== CONSTANTS =====

export const HIDDEN_VALUE = '__HIDDEN__'

/**
 * Default credit limits by quota type
 * Credits are charged per AI invocation (1 credit = 1 AI call)
 */
export const DEFAULT_QUOTA_LIMITS = {
  [ProviderQuotaType.TRIAL]: 50, // 50 AI invocations for trial
  [ProviderQuotaType.FREE]: 100, // 100 AI invocations per month
  [ProviderQuotaType.PAID]: 1000, // Starter: 1,000 AI invocations per month
} as const

/**
 * Plan-specific credit limits (set directly, no multipliers)
 * These are the monthly AI invocation limits for each subscription tier
 */
export const PLAN_CREDIT_LIMITS = {
  starter: 1000,
  growth: 5000,
  business: 20000,
  enterprise: 100000,
} as const

export type PlanTier = keyof typeof PLAN_CREDIT_LIMITS

export const DEFAULT_CACHE_TTL = {
  PROVIDER_CONFIG: 900, // 15 minutes
  CREDENTIALS: 300, // 5 minutes
  MODEL_INSTANCE: 1800, // 30 minutes
} as const

export const SUPPORTED_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'groq',
  'deepseek',
  'qwen',
  'kimi',
] as const

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number]

// Type guards
export const isModelType = (value: string): value is ModelType => {
  return Object.values(ModelType).includes(value as ModelType)
}

export const isProviderType = (value: string): value is ProviderType => {
  return Object.values(ProviderType).includes(value as ProviderType)
}

export const isProviderQuotaType = (value: string): value is ProviderQuotaType => {
  return Object.values(ProviderQuotaType).includes(value as ProviderQuotaType)
}

export const isSupportedProvider = (value: string): value is SupportedProvider => {
  return SUPPORTED_PROVIDERS.includes(value as SupportedProvider)
}
