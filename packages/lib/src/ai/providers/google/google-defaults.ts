// packages/lib/src/ai/providers/google/google-defaults.ts

import { FetchFrom, type ModelCapabilities, ModelType, type ProviderCapabilities } from '../types'

export const GOOGLE_CAPABILITIES: ProviderCapabilities = {
  id: 'google',
  displayName: 'Google',
  icon: 'google',
  color: '#4285F4',
  supportedModelTypes: [ModelType.LLM, ModelType.VISION, ModelType.TEXT_EMBEDDING],
  defaultModel: 'gemini-2.5-flash',
  requiresApiKey: true,
  toolFormat: 'google',
  configurateMethods: ['predefined-model', 'customizable-model'],

  credentialSchema: [
    {
      variable: 'google_api_key',
      type: 'secret-input',
      label: 'API Key',
      placeholder: 'Enter your Google AI API Key',
      required: true,
      scope: 'both',
      priority: 'model-override',
      helpText: 'Your Google AI API key from Google AI Studio',
      validation: {
        pattern: '^AIza[0-9A-Za-z-_]{35}$',
        message: 'Google AI API key must start with AIza and be 39 characters long',
      },
    },
  ],

  rateLimits: {
    requestsPerMinute: 60,
    tokensPerMinute: 30000,
    cacheTtl: 300,
  },
  description:
    "Google's advanced multimodal AI models with large context windows and thinking capabilities",
  documentationUrl: 'https://ai.google.dev/docs',
  setupInstructions:
    'Get your API key from Google AI Studio at https://aistudio.google.com/app/apikey',
}

// ===== Shared parameter rules =====

const temperatureRule = {
  name: 'temperature',
  type: 'float' as const,
  label: 'Temperature',
  help: 'Controls the randomness of the generated text.',
  default: 1,
  min: 0,
  max: 2,
  precision: 2,
  required: false,
  template: 'temperature',
}

const topPRule = {
  name: 'topP',
  type: 'float' as const,
  label: 'Top P',
  help: 'Controls diversity via nucleus sampling.',
  default: 0.95,
  min: 0,
  max: 1,
  precision: 2,
  required: false,
  template: 'top_p',
}

const topKRule = {
  name: 'topK',
  type: 'int' as const,
  label: 'Top K',
  help: 'Number of highest probability tokens to consider.',
  default: 40,
  min: 1,
  max: 100,
  precision: 0,
  required: false,
  template: 'top_k',
}

const maxOutputTokensRule = {
  name: 'maxOutputTokens',
  type: 'int' as const,
  label: 'Max Output Tokens',
  help: 'Maximum number of tokens to generate.',
  default: 8192,
  min: 1,
  max: 65536,
  precision: 0,
  required: false,
  template: 'max_tokens',
}

const thinkingBudgetRule = {
  name: 'thinkingBudget',
  type: 'int' as const,
  label: 'Thinking Budget',
  help: 'Maximum tokens for the model thinking process (0 to disable).',
  default: 0,
  min: 0,
  max: 24576,
  precision: 0,
  required: false,
  template: 'thinking_budget',
}

const standardLlmParams = [temperatureRule, topPRule, topKRule, maxOutputTokensRule]

const thinkingLlmParams = [...standardLlmParams, thinkingBudgetRule]

// ===== Shared supports objects =====

const fullLlmSupports = {
  streaming: true,
  structured: true,
  vision: true,
  toolCalling: true,
  systemMessages: true,
  fileInput: true,
}

const embeddingSupports = {
  streaming: false,
  structured: false,
  vision: false,
  toolCalling: false,
  systemMessages: false,
  fileInput: false,
}

const thinkingRestrictions = {
  isReasoningModel: true,
  supportedParams: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'thinkingBudget'],
}

// ===== Model definitions =====

export const GOOGLE_MODELS: Record<string, ModelCapabilities> = {
  // ===== Gemini 3.x Models (Latest) =====

  'gemini-3.1-pro-preview': {
    provider: 'google',
    modelId: 'gemini-3.1-pro-preview',
    creditMultiplier: 3,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 3.1 Pro',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 65536,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal', 'tools', 'thinking'],
    supports: fullLlmSupports,
    costPer1kTokens: { input: 0.002, output: 0.012 },
    description: 'Most advanced reasoning model for complex agentic workflows and coding',
    parameterRules: thinkingLlmParams,
    parameterRestrictions: thinkingRestrictions,
  },

  'gemini-3-flash-preview': {
    provider: 'google',
    modelId: 'gemini-3-flash-preview',
    creditMultiplier: 1,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 3 Flash',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 65536,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal', 'tools', 'thinking'],
    supports: fullLlmSupports,
    costPer1kTokens: { input: 0.0005, output: 0.003 },
    description: 'Frontier-class performance rivaling larger models at a fraction of the cost',
    parameterRules: thinkingLlmParams,
    parameterRestrictions: thinkingRestrictions,
  },

  'gemini-3.1-flash-lite-preview': {
    provider: 'google',
    modelId: 'gemini-3.1-flash-lite-preview',
    creditMultiplier: 1,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 3.1 Flash Lite',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 65536,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal', 'tools', 'thinking'],
    supports: fullLlmSupports,
    costPer1kTokens: { input: 0.00025, output: 0.0015 },
    description: 'Most cost-efficient model for high-frequency lightweight tasks',
    parameterRules: thinkingLlmParams,
    parameterRestrictions: thinkingRestrictions,
  },

  // ===== Gemini 2.5 Models (Stable) =====

  'gemini-2.5-pro': {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    creditMultiplier: 3,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 2.5 Pro',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 65536,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal', 'tools', 'thinking'],
    supports: fullLlmSupports,
    costPer1kTokens: { input: 0.00125, output: 0.01 },
    description: 'Deep reasoning and coding with 1M token context',
    parameterRules: thinkingLlmParams,
    parameterRestrictions: thinkingRestrictions,
  },

  'gemini-2.5-flash': {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    creditMultiplier: 1,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 2.5 Flash',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 65536,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal', 'tools', 'thinking'],
    supports: fullLlmSupports,
    costPer1kTokens: { input: 0.0003, output: 0.0025 },
    description: 'Best price-performance for low-latency, high-volume reasoning tasks',
    parameterRules: thinkingLlmParams,
    parameterRestrictions: thinkingRestrictions,
  },

  'gemini-2.5-flash-lite': {
    provider: 'google',
    modelId: 'gemini-2.5-flash-lite',
    creditMultiplier: 1,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 2.5 Flash Lite',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 65536,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal', 'tools', 'thinking'],
    supports: fullLlmSupports,
    costPer1kTokens: { input: 0.0001, output: 0.0004 },
    description: 'Fastest and most budget-friendly multimodal model',
    parameterRules: thinkingLlmParams,
    parameterRestrictions: thinkingRestrictions,
  },

  // ===== Deprecated LLM Models =====

  'gemini-2.0-flash': {
    provider: 'google',
    modelId: 'gemini-2.0-flash',
    creditMultiplier: 1,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 2.0 Flash',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 8192,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal'],
    supports: {
      streaming: true,
      structured: true,
      vision: true,
      toolCalling: true,
      systemMessages: true,
      fileInput: true,
    },
    costPer1kTokens: { input: 0.0001, output: 0.0004 },
    deprecated: true,
    replacement: 'gemini-2.5-flash',
    description: 'Deprecated - shuts down June 1, 2026. Use gemini-2.5-flash instead.',
    parameterRules: standardLlmParams,
  },

  'gemini-2.0-flash-lite': {
    provider: 'google',
    modelId: 'gemini-2.0-flash-lite',
    creditMultiplier: 1,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 2.0 Flash Lite',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1048576,
    maxTokens: 8192,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal'],
    supports: {
      streaming: true,
      structured: true,
      vision: true,
      toolCalling: true,
      systemMessages: true,
      fileInput: true,
    },
    costPer1kTokens: { input: 0.000075, output: 0.0003 },
    deprecated: true,
    replacement: 'gemini-2.5-flash-lite',
    description: 'Deprecated - shuts down June 1, 2026. Use gemini-2.5-flash-lite instead.',
    parameterRules: standardLlmParams,
  },

  'gemini-1.5-pro-latest': {
    provider: 'google',
    modelId: 'gemini-1.5-pro-latest',
    creditMultiplier: 3,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 1.5 Pro (Legacy)',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1000000,
    maxTokens: 8192,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal'],
    supports: {
      streaming: true,
      structured: false,
      vision: true,
      toolCalling: true,
      systemMessages: true,
      fileInput: true,
    },
    retired: true,
    replacement: 'gemini-2.5-pro',
    description: 'Retired - already shut down. Use gemini-2.5-pro instead.',
    parameterRules: [],
  },

  'gemini-1.5-flash-latest': {
    provider: 'google',
    modelId: 'gemini-1.5-flash-latest',
    creditMultiplier: 1,
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini 1.5 Flash (Legacy)',
    icon: 'google',
    color: '#4285F4',
    contextLength: 1000000,
    maxTokens: 8192,
    modelType: ModelType.LLM,
    features: ['chat', 'multimodal'],
    supports: {
      streaming: true,
      structured: false,
      vision: true,
      toolCalling: true,
      systemMessages: true,
      fileInput: true,
    },
    retired: true,
    replacement: 'gemini-2.5-flash',
    description: 'Retired - already shut down. Use gemini-2.5-flash instead.',
    parameterRules: [],
  },

  // ===== Embedding Models =====

  'gemini-embedding-2-preview': {
    provider: 'google',
    modelId: 'gemini-embedding-2-preview',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini Embedding 2',
    icon: 'google',
    color: '#4285F4',
    contextLength: 8192,
    maxTokens: 8192,
    modelType: ModelType.TEXT_EMBEDDING,
    features: ['text-embedding', 'multimodal-embedding'],
    supports: embeddingSupports,
    costPer1kTokens: { input: 0.0002, output: 0 },
    description: 'Multimodal embedding model supporting text, image, video, audio, and PDF',
    parameterRules: [
      {
        name: 'dimensions',
        type: 'int',
        label: 'Dimensions',
        help: 'Number of dimensions for the embedding vector',
        default: 3072,
        required: false,
        template: 'dimensions',
        options: ['128', '256', '512', '768', '1536', '3072'],
      },
    ],
  },

  'gemini-embedding-001': {
    provider: 'google',
    modelId: 'gemini-embedding-001',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gemini Embedding',
    icon: 'google',
    color: '#4285F4',
    contextLength: 2048,
    maxTokens: 2048,
    modelType: ModelType.TEXT_EMBEDDING,
    features: ['text-embedding'],
    supports: embeddingSupports,
    costPer1kTokens: { input: 0.00015, output: 0 },
    description: 'Text embedding model with configurable dimensions',
    parameterRules: [
      {
        name: 'dimensions',
        type: 'int',
        label: 'Dimensions',
        help: 'Number of dimensions for the embedding vector',
        default: 768,
        required: false,
        template: 'dimensions',
        options: ['128', '256', '512', '768', '1536', '3072'],
      },
    ],
  },

  // ===== Deprecated Embedding Models =====

  'text-embedding-004': {
    provider: 'google',
    modelId: 'text-embedding-004',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Text Embedding 004 (Legacy)',
    icon: 'google',
    color: '#4285F4',
    contextLength: 2048,
    maxTokens: 2048,
    modelType: ModelType.TEXT_EMBEDDING,
    features: ['text-embedding'],
    supports: embeddingSupports,
    costPer1kTokens: { input: 0.00002, output: 0 },
    retired: true,
    replacement: 'gemini-embedding-001',
    description: 'Retired - shut down January 14, 2026. Use gemini-embedding-001 instead.',
    parameterRules: [],
  },

  'textembedding-gecko@003': {
    provider: 'google',
    modelId: 'textembedding-gecko@003',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Gecko Embedding 003 (Legacy)',
    icon: 'google',
    color: '#4285F4',
    contextLength: 3072,
    maxTokens: 3072,
    modelType: ModelType.TEXT_EMBEDDING,
    features: ['text-embedding'],
    supports: embeddingSupports,
    costPer1kTokens: { input: 0.000025, output: 0 },
    retired: true,
    replacement: 'gemini-embedding-001',
    description: 'Retired - legacy Vertex AI model. Use gemini-embedding-001 instead.',
    parameterRules: [],
  },
}
