// packages/lib/src/ai/providers/qwen/qwen-defaults.ts

import { FetchFrom, type ModelCapabilities, ModelType, type ProviderCapabilities } from '../types'

export const QWEN_CAPABILITIES: ProviderCapabilities = {
  id: 'qwen',
  displayName: 'Qwen',
  icon: 'qwen',
  color: '#615EFF',
  supportedModelTypes: [ModelType.LLM],
  defaultModel: 'qwen-plus-us',
  requiresApiKey: true,
  toolFormat: 'openai',
  configurateMethods: ['predefined-model', 'customizable-model'],

  credentialSchema: [
    {
      variable: 'qwen_api_key',
      type: 'secret-input',
      label: 'API Key',
      placeholder: 'Enter your DashScope API Key',
      required: true,
      scope: 'both',
      priority: 'model-override',
      helpText: 'Your DashScope API key from Alibaba Cloud Model Studio',
      validation: {
        pattern: '^sk-[a-zA-Z0-9\\-]+$',
        message: 'API key must start with sk-',
      },
    },
    {
      variable: 'qwen_api_base',
      type: 'select',
      label: 'Region',
      required: false,
      scope: 'provider',
      priority: 'provider-only',
      default: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
      helpText: 'Select your DashScope region. API keys are region-specific.',
      options: [
        {
          label: 'US (Virginia)',
          value: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
        },
        {
          label: 'Singapore (International)',
          value: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        },
        {
          label: 'China (Beijing)',
          value: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
      ],
    },
  ],

  rateLimits: {
    requestsPerMinute: 60,
    tokensPerMinute: 10000,
    cacheTtl: 300,
  },
  description: 'Large language models by Alibaba Cloud',
  documentationUrl: 'https://www.alibabacloud.com/help/en/model-studio/',
  setupInstructions:
    'Get your API key from Alibaba Cloud Model Studio at https://dashscope.console.aliyun.com/apiKey',
}

const QWEN_PARAMETER_RULES = [
  {
    name: 'temperature',
    type: 'float' as const,
    label: 'Temperature',
    help: 'Controls randomness in responses.',
    default: 0.7,
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
    default: 0.7,
    min: 0,
    max: 1,
    precision: 2,
    required: false,
    template: 'top_p',
  },
  {
    name: 'presencePenalty',
    type: 'float' as const,
    label: 'Presence Penalty',
    help: 'Penalizes tokens that have already appeared.',
    default: 0,
    min: -2,
    max: 2,
    precision: 2,
    required: false,
    template: 'presence_penalty',
  },
  {
    name: 'maxOutputTokens',
    type: 'int' as const,
    label: 'Max Output Tokens',
    help: 'Maximum number of tokens to generate.',
    default: 8192,
    min: 1,
    max: 32768,
    precision: 0,
    required: false,
    template: 'max_tokens',
  },
]

export const QWEN_MODELS: Record<string, ModelCapabilities> = {
  'qwen-plus-us': {
    provider: 'qwen',
    modelId: 'qwen-plus-us',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Qwen Plus (US)',
    icon: 'qwen',
    color: '#615EFF',
    contextLength: 1000000,
    maxTokens: 32768,
    modelType: ModelType.LLM,
    features: ['chat', 'code'],
    supports: {
      streaming: true,
      structured: true,
      vision: false,
      toolCalling: true,
      systemMessages: true,
      fileInput: false,
    },
    costPer1kTokens: { input: 0.0004, output: 0.0012 },
    description: 'Qwen Plus for the US (Virginia) region. Use with the US region endpoint.',
    parameterRules: QWEN_PARAMETER_RULES,
  },
  'qwen-plus-latest': {
    provider: 'qwen',
    modelId: 'qwen-plus-latest',
    fetchFrom: FetchFrom.PREDEFINED_MODEL,
    displayName: 'Qwen Plus (International)',
    icon: 'qwen',
    color: '#615EFF',
    contextLength: 1000000,
    maxTokens: 32768,
    modelType: ModelType.LLM,
    features: ['chat', 'code'],
    supports: {
      streaming: true,
      structured: true,
      vision: false,
      toolCalling: true,
      systemMessages: true,
      fileInput: false,
    },
    costPer1kTokens: { input: 0.0004, output: 0.0012 },
    description:
      'Qwen Plus for Singapore (International) and China regions. Not available in the US region.',
    parameterRules: QWEN_PARAMETER_RULES,
  },
}
