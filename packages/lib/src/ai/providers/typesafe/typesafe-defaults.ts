// packages/lib/src/ai/providers/typesafe/typesafe-defaults.ts

import { FetchFrom, type ModelCapabilities, ModelType, type ProviderCapabilities } from '../types'

export const TYPESAFE_CAPABILITIES: ProviderCapabilities = {
  id: 'typesafe',
  displayName: 'TypeSafe',
  icon: 'typesafe',
  color: '#111827',
  supportedModelTypes: [ModelType.DECISION],
  defaultModel: 'jev-1.13.0',
  requiresApiKey: true,
  toolFormat: 'custom',
  configurateMethods: ['predefined-model'],
  // Hidden until shadow-mode numbers are in (plans/ai/decision/00-decision-model-type.md D7).
  visibility: 'internal',

  connectionVariables: [
    {
      key: 'apiKey',
      label: 'API Key',
      placeholder: 'Enter your TypeSafe API Key',
      required: true,
      secret: true,
      description: 'Your API key from the TypeSafe console',
    },
  ],
  fieldMeta: {
    apiKey: { scope: 'both', priority: 'model-override' },
  },

  rateLimits: {
    requestsPerMinute: 1200,
    cacheTtl: 300,
  },
  description: 'Jev decision models by TypeSafe AI: typed choice, score and yes/no answers',
  documentationUrl: 'https://docs.typesafe.ai/api.md',
  setupInstructions: 'Get your API key from the TypeSafe console at https://typesafe.ai',
}

// Pinned version only; `jev-latest` would silently move calibrated thresholds (D8).
export const TYPESAFE_MODELS: Record<string, ModelCapabilities> = {
  'jev-1.13.0': {
    provider: 'typesafe',
    modelId: 'jev-1.13.0',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Jev 1.13',
    icon: 'typesafe',
    color: '#111827',
    contextLength: 64_000,
    maxTokens: 0,
    modelType: ModelType.DECISION,
    features: ['decision'],
    supports: {
      streaming: false,
      structured: true,
      vision: false,
      toolCalling: false,
      systemMessages: false,
      fileInput: false,
    },
    costPer1kTokens: { input: 0.000042, output: 0 },
    description:
      'TypeSafe Jev 1.13: answers choice, score and yes/no questions with calibrated confidence. Text only.',
    parameterRules: [],
  },
}
