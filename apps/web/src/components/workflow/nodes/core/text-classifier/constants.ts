// apps/web/src/components/workflow/nodes/core/text-classifier/constants.ts

/**
 * Default category name prefix
 */
export const DEFAULT_CATEGORY_PREFIX = 'Category'

/**
 * Maximum number of categories allowed
 */
export const MAX_CATEGORIES = 20

/**
 * Minimum number of categories required
 */
export const MIN_CATEGORIES = 1

/**
 * Default confidence threshold for classification
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7

/**
 * Connection IDs for text classifier branches
 */
export const CONNECTION_IDS = {
  DEFAULT: 'default',
  UNMATCHED: 'unmatched',
} as const

/**
 * Default system prompt for classification
 */
export const DEFAULT_CLASSIFICATION_PROMPT = `You are a text classification assistant. Your task is to classify the given text into one of the predefined categories based on their descriptions.

Analyze the text carefully and select the most appropriate category. Provide your response in the following JSON format:
{
  "category": "category_name",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why this category was chosen"
}

Be precise and consider all aspects of the text when making your classification.`
