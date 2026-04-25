// packages/lib/src/workflow-engine/constants/nodes/ai.ts

import type { NodeConstants } from '../types'
import { createRangeValidator } from '../validation'

/**
 * Constants for AI-related nodes (AI, Text Classifier, Information Extractor)
 */
export const AI_NODE_CONSTANTS = {
  // AI providers and their models
  PROVIDERS: {
    OPENAI: {
      name: 'openai',
      models: [
        'gpt-5.5',
        'gpt-5.5-pro',
        'gpt-5.4-nano',
        'gpt-5.4-mini',
        'gpt-5.4',
        'gpt-4o-mini',
        'gpt-4o',
      ] as const,
    },
    ANTHROPIC: {
      name: 'anthropic',
      models: [
        'claude-sonnet-4-6',
        'claude-opus-4-6',
        'claude-haiku-4-5-20251001',
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-20241022',
      ] as const,
    },
  },

  // Prompt roles
  PROMPT_ROLES: ['system', 'user', 'assistant'] as const,

  // Temperature configuration
  TEMPERATURE: createRangeValidator({ min: 0, max: 2, default: 0.7 }),

  // Token limits
  MAX_TOKENS: createRangeValidator({ min: 1, max: 128000, default: 2048 }),

  // Top P configuration
  TOP_P: createRangeValidator({ min: 0, max: 1, default: 1 }),

  // Frequency penalty
  FREQUENCY_PENALTY: createRangeValidator({ min: -2, max: 2, default: 0 }),

  // Presence penalty
  PRESENCE_PENALTY: createRangeValidator({ min: -2, max: 2, default: 0 }),

  // Text classifier specific
  TEXT_CLASSIFIER: {
    MAX_CATEGORIES: 20,
    MIN_CATEGORIES: 1,
    CATEGORY_NAME_MAX_LENGTH: 50,
    CATEGORY_DESCRIPTION_MAX_LENGTH: 200,
  },

  // Information extractor specific
  INFO_EXTRACTOR: {
    MAX_FIELDS: 50,
    FIELD_NAME_MAX_LENGTH: 50,
    FIELD_DESCRIPTION_MAX_LENGTH: 200,
    FIELD_TYPES: ['string', 'number', 'boolean', 'date', 'array', 'object'] as const,
  },

  // Common limits
  PROMPT: {
    MAX_LENGTH: 32000, // characters
    MIN_LENGTH: 1,
  },
} as const satisfies NodeConstants

// Type exports
export type AIProvider = 'openai' | 'anthropic'
export type OpenAIModel = (typeof AI_NODE_CONSTANTS.PROVIDERS.OPENAI.models)[number]
export type AnthropicModel = (typeof AI_NODE_CONSTANTS.PROVIDERS.ANTHROPIC.models)[number]
export type AIModel = OpenAIModel | AnthropicModel
export type PromptRole = (typeof AI_NODE_CONSTANTS.PROMPT_ROLES)[number]
export type InfoExtractorFieldType = (typeof AI_NODE_CONSTANTS.INFO_EXTRACTOR.FIELD_TYPES)[number]

// Helper function to get models for a provider
export function getModelsForProvider(provider: AIProvider): readonly string[] {
  switch (provider) {
    case 'openai':
      return AI_NODE_CONSTANTS.PROVIDERS.OPENAI.models
    case 'anthropic':
      return AI_NODE_CONSTANTS.PROVIDERS.ANTHROPIC.models
    default:
      return []
  }
}

// Helper function to validate model for provider
export function isValidModelForProvider(provider: AIProvider, model: string): boolean {
  const models = getModelsForProvider(provider)
  return models.includes(model)
}
