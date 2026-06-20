// packages/lib/src/ai/providers/groq/groq-defaults.ts

import { FetchFrom, type ModelCapabilities, ModelType, type ProviderCapabilities } from '../types'

export const GROQ_CAPABILITIES: ProviderCapabilities = {
  id: 'groq',
  displayName: 'Groq',
  icon: 'groq',
  color: '#000000',
  supportedModelTypes: [ModelType.LLM],
  defaultModel: 'llama-3.3-70b-versatile',
  requiresApiKey: true,
  toolFormat: 'openai', // Groq uses OpenAI-compatible API
  configurateMethods: ['predefined-model', 'customizable-model'],

  // Shared connection-variable descriptors (AI scope/priority lives in fieldMeta).
  connectionVariables: [
    {
      key: 'apiKey',
      label: 'API Key',
      placeholder: 'Enter your Groq API Key',
      required: true,
      secret: true,
      description: 'Your Groq API key from the Groq console',
      validation: {
        pattern: '^gsk_[a-zA-Z0-9]{52}$',
        message: 'Groq API key must start with gsk_ and be 56 characters long',
      },
    },
  ],
  fieldMeta: {
    apiKey: { scope: 'both', priority: 'model-override' },
  },

  rateLimits: {
    requestsPerMinute: 30,
    tokensPerMinute: 6000,
    cacheTtl: 300, // 5 minutes
  },
  description: 'Ultra-fast AI inference on specialized hardware',
  documentationUrl: 'https://console.groq.com/docs/quickstart',
  setupInstructions: 'Get your API key from the Groq console at https://console.groq.com/keys',
}

export const GROQ_MODELS: Record<string, ModelCapabilities> = {
  'llama-3.3-70b-versatile': {
    provider: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Groq Llama 3.3 70B',
    icon: 'groq',
    color: '#000000',
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
    costPer1kTokens: { input: 0.00059, output: 0.00079 },
    description: 'High-speed inference on Groq hardware',
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
