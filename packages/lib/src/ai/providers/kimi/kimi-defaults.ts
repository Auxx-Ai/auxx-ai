// packages/lib/src/ai/providers/kimi/kimi-defaults.ts

import { FetchFrom, type ModelCapabilities, ModelType, type ProviderCapabilities } from '../types'

export const KIMI_CAPABILITIES: ProviderCapabilities = {
  id: 'kimi',
  displayName: 'Kimi',
  icon: 'kimi',
  color: '#027AFF',
  supportedModelTypes: [ModelType.LLM],
  defaultModel: 'kimi-k2.5',
  requiresApiKey: true,
  toolFormat: 'openai',
  configurateMethods: ['predefined-model', 'customizable-model'],

  credentialSchema: [
    {
      variable: 'kimi_api_key',
      type: 'secret-input',
      label: 'API Key',
      placeholder: 'Enter your Moonshot API Key',
      required: true,
      scope: 'both',
      priority: 'model-override',
      helpText: 'Your API key from the Kimi API Platform console',
      validation: {
        pattern: '^sk-[a-zA-Z0-9\\-_]{10,}$',
        message: 'API key must start with sk-',
      },
    },
  ],

  rateLimits: {
    requestsPerMinute: 60,
    tokensPerMinute: 10000,
    cacheTtl: 300,
  },
  description: 'Large language models by Moonshot AI',
  documentationUrl: 'https://platform.moonshot.ai/docs/overview',
  setupInstructions:
    'Get your API key from the Kimi API Platform at https://platform.moonshot.ai/console/api-keys',
}

export const KIMI_MODELS: Record<string, ModelCapabilities> = {
  'kimi-k2.5': {
    provider: 'kimi',
    modelId: 'kimi-k2.5',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Kimi K2.5',
    icon: 'kimi',
    color: '#027AFF',
    contextLength: 262144,
    maxTokens: 262144,
    modelType: ModelType.LLM,
    features: ['chat', 'code', 'vision'],
    supports: {
      streaming: true,
      structured: true,
      vision: true,
      toolCalling: true,
      systemMessages: true,
      fileInput: false,
    },
    costPer1kTokens: { input: 0.0006, output: 0.0025 },
    description:
      'Moonshot AI most capable model with 262K context, native multimodal support, tool calling, and structured output. Sampling parameters (temperature, top_p) are fixed by the model.',
    parameterRestrictions: {
      isReasoningModel: false,
      supportedParams: ['max_tokens'],
      unsupportedParams: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty'],
    },
    parameterRules: [
      {
        name: 'maxOutputTokens',
        type: 'int',
        label: 'Max Output Tokens',
        help: 'Maximum number of tokens to generate.',
        default: 8192,
        min: 1,
        max: 262144,
        precision: 0,
        required: false,
        template: 'max_tokens',
      },
    ],
  },
}
