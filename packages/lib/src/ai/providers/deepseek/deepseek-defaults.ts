// packages/lib/src/ai/providers/deepseek/deepseek-defaults.ts

import { FetchFrom, type ModelCapabilities, ModelType, type ProviderCapabilities } from '../types'

export const DEEPSEEK_CAPABILITIES: ProviderCapabilities = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  icon: 'deepseek',
  color: '#4F46E5',
  supportedModelTypes: [ModelType.LLM],
  defaultModel: 'deepseek-chat',
  requiresApiKey: true,
  toolFormat: 'openai', // DeepSeek uses OpenAI-compatible API
  configurateMethods: ['predefined-model', 'customizable-model'],

  // NEW: Unified credential schema with scope-based filtering
  credentialSchema: [
    {
      variable: 'deepseek_api_key',
      type: 'secret-input',
      label: 'API Key',
      placeholder: 'Enter your DeepSeek API Key',
      required: true,
      scope: 'both', // Available for both provider and model config
      priority: 'model-override', // Model-level key overrides provider key
      helpText: 'Your DeepSeek API key from the DeepSeek platform',
      validation: {
        pattern: '^sk-[a-zA-Z0-9]{48}$',
        message: 'DeepSeek API key must start with sk- and be 51 characters long',
      },
    },
  ],

  rateLimits: {
    requestsPerMinute: 60,
    tokensPerMinute: 10000,
    cacheTtl: 300, // 5 minutes
  },
  description: 'Advanced reasoning AI models by DeepSeek',
  documentationUrl: 'https://platform.deepseek.com/docs',
  setupInstructions:
    'Get your API key from the DeepSeek platform at https://platform.deepseek.com/',
}

export const DEEPSEEK_MODELS: Record<string, ModelCapabilities> = {
  'deepseek-chat': {
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'DeepSeek Chat',
    icon: 'deepseek',
    color: '#4F46E5',
    contextLength: 32768,
    maxTokens: 8192,
    modelType: ModelType.LLM,
    features: ['chat'],
    supports: {
      streaming: true,
      structured: false,
      vision: false,
      toolCalling: false,
      systemMessages: true,
      fileInput: false,
    },
    description: "DeepSeek's conversational AI model",
    parameterRules: [
      {
        name: 'temperature',
        type: 'float',
        label: 'Temperature',
        help: 'Controls randomness in responses.',
        default: 0.7,
        min: 0,
        max: 1,
        precision: 2,
        required: false,
        template: 'temperature',
      },
    ],
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    modelId: 'deepseek-reasoner',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'DeepSeek Reasoner',
    icon: 'deepseek',
    color: '#4F46E5',
    contextLength: 32768,
    maxTokens: 8192,
    modelType: ModelType.LLM,
    features: ['chat', 'reasoning'],
    supports: {
      streaming: true,
      structured: false,
      vision: false,
      toolCalling: false,
      systemMessages: true,
      fileInput: false,
    },
    description: 'DeepSeek model with enhanced reasoning capabilities',
    parameterRules: [
      {
        name: 'temperature',
        type: 'float',
        label: 'Temperature',
        help: 'Controls randomness in responses.',
        default: 0.7,
        min: 0,
        max: 1,
        precision: 2,
        required: false,
        template: 'temperature',
      },
    ],
  },
}
