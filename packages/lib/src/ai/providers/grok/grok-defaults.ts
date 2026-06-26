// packages/lib/src/ai/providers/grok/grok-defaults.ts

import { FetchFrom, type ModelCapabilities, ModelType, type ProviderCapabilities } from '../types'

export const GROK_CAPABILITIES: ProviderCapabilities = {
  id: 'grok',
  displayName: 'Grok',
  icon: 'grok',
  color: '#000000',
  supportedModelTypes: [ModelType.LLM],
  defaultModel: 'grok-4.3',
  requiresApiKey: true,
  toolFormat: 'openai',
  configurateMethods: ['predefined-model', 'customizable-model'],

  // Shared connection-variable descriptors (AI scope/priority lives in fieldMeta).
  connectionVariables: [
    {
      key: 'apiKey',
      label: 'API Key',
      placeholder: 'Enter your xAI API Key',
      required: true,
      secret: true,
      description: 'Your API key from the xAI console (console.x.ai)',
      validation: {
        pattern: '^xai-[a-zA-Z0-9\\-_]{20,}$',
        message: 'xAI API key must start with xai-',
      },
    },
  ],
  fieldMeta: {
    apiKey: { scope: 'both', priority: 'model-override' },
  },

  rateLimits: {
    requestsPerMinute: 60,
    tokensPerMinute: 16000,
    cacheTtl: 300,
  },
  description: 'Grok frontier models by xAI',
  documentationUrl: 'https://docs.x.ai/docs/overview',
  setupInstructions: 'Get your API key from the xAI console at https://console.x.ai',
}

/** Grok reasoning models accept reasoning_effort none/low/medium/high (grok-4.3 default: low). */
const GROK_REASONING_EFFORT = {
  name: 'reasoning_effort',
  type: 'string' as const,
  label: 'Reasoning Effort',
  help: 'Controls how much reasoning the model performs before answering.',
  default: 'low',
  required: false,
  template: 'reasoning_effort',
  options: ['none', 'low', 'medium', 'high'],
}

const GROK_PARAMETER_RULES = [
  GROK_REASONING_EFFORT,
  {
    name: 'temperature',
    type: 'float' as const,
    label: 'Temperature',
    help: 'Controls randomness in responses.',
    default: 1,
    min: 0,
    max: 2,
    precision: 2,
    required: false,
    template: 'temperature',
  },
  {
    name: 'topP',
    type: 'float' as const,
    label: 'Top P',
    help: 'Nucleus sampling threshold.',
    default: 1,
    min: 0,
    max: 1,
    precision: 2,
    required: false,
    template: 'top_p',
  },
  {
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
  },
]

// logprobs/top_logprobs are unsupported by grok-4.20 and newer; penalties unsupported on reasoning models.
const GROK_REASONING_RESTRICTIONS = {
  isReasoningModel: true,
  supportedParams: ['reasoning_effort', 'temperature', 'top_p', 'max_tokens'],
  unsupportedParams: ['logprobs', 'top_logprobs', 'presence_penalty', 'frequency_penalty'],
}

// Non-reasoning variant: no reasoning_effort, otherwise the same sampling surface.
const GROK_NON_REASONING_PARAMETER_RULES = GROK_PARAMETER_RULES.filter(
  (rule) => rule.name !== 'reasoning_effort'
)

const GROK_NON_REASONING_RESTRICTIONS = {
  isReasoningModel: false,
  supportedParams: ['temperature', 'top_p', 'max_tokens'],
  unsupportedParams: ['logprobs', 'top_logprobs', 'presence_penalty', 'frequency_penalty'],
}

export const GROK_MODELS: Record<string, ModelCapabilities> = {
  'grok-4.3': {
    provider: 'grok',
    modelId: 'grok-4.3',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Grok 4.3',
    icon: 'grok',
    color: '#000000',
    contextLength: 1_000_000,
    maxTokens: 65536,
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
    costPer1kTokens: { input: 0.00125, output: 0.0025, cachedInput: 0.0002 },
    description:
      'xAI flagship reasoning model. 1M context, image input, tool calling, structured outputs, and controllable reasoning effort (none/low/medium/high).',
    parameterRestrictions: GROK_REASONING_RESTRICTIONS,
    parameterRules: GROK_PARAMETER_RULES,
  },
  'grok-4.20-0309-reasoning': {
    provider: 'grok',
    modelId: 'grok-4.20-0309-reasoning',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Grok 4.20 (Reasoning)',
    icon: 'grok',
    color: '#000000',
    contextLength: 1_000_000,
    maxTokens: 65536,
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
    costPer1kTokens: { input: 0.00125, output: 0.0025, cachedInput: 0.0002 },
    description:
      'Premium Grok reasoning model. 1M context, controllable reasoning effort. logprobs/top_logprobs are unsupported.',
    parameterRestrictions: GROK_REASONING_RESTRICTIONS,
    parameterRules: GROK_PARAMETER_RULES,
  },
  'grok-4.20-0309-non-reasoning': {
    provider: 'grok',
    modelId: 'grok-4.20-0309-non-reasoning',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Grok 4.20 (Non-Reasoning)',
    icon: 'grok',
    color: '#000000',
    contextLength: 1_000_000,
    maxTokens: 65536,
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
    costPer1kTokens: { input: 0.00125, output: 0.0025, cachedInput: 0.0002 },
    description:
      'Fast non-reasoning Grok 4.20. 1M context, vision + tool calling. Best for low-latency, high-volume workloads.',
    parameterRestrictions: GROK_NON_REASONING_RESTRICTIONS,
    parameterRules: GROK_NON_REASONING_PARAMETER_RULES,
  },
}
